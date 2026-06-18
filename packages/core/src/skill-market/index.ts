// The marketplace MCP surface — the tools an agent (or a person, via a surface) uses to
// shop for a skill. Rebuilt per plans/skill-shopping.md.
//
// The model (plan §3): verify is HALF code, HALF agent, and engine-agnostic.
//   ① [code]  scanSkillText() rejects obvious danger (rm -rf, key exfiltration, base64-
//             obfuscated payloads) outright — no model needed.
//   ② [agent] the agent reads the body against the `verify-skill` rubric and decides, on
//             balance, if it's safe. This happens in the agent's own turn (so it works the
//             same on claude and codex — we are NOT an API agent that could spawn an
//             isolated claude judge).
//   ③ [code]  a VerifyGuard records which skills cleared step ① this session; `buy` is
//             refused unless the guard has the skill. Plus the user's approval is the
//             final backstop — verify is a first filter, never the only defense.
//
// Tools exposed to the agent: search_skills, verify_skill, buy_skill (the low-level
// trio). `browse_skills` (search + ① folded together, plan §4) is the high-level entry a
// surface calls; it lives in browse.ts and reuses the pieces here.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Connection } from "@solana/web3.js";
import type { SignerInput } from "@iqlabs-official/solana-sdk/utils";
import { searchSkills } from "../search/search.js";
import { publishSkill } from "../nft/skill.js";
import { readSkillText } from "../nft/token2022.js";
import { SkillSync } from "./ingest/index.js";
import { postNote, postAgentNote } from "../notes/notes.js";
import { getSkillsCollectionMint, getWorkflowsCollectionMint } from "../core/seed.js";
import { scanSkillText } from "./scan.js";
import { VERIFY_RUBRIC } from "./rubric.js";
import { solToLamports } from "./ingest/env.js";

/**
 * Per-session record of which skills cleared the code-side verify scan (plan §3 ③).
 * `buy_skill` is refused unless the guard holds the skill. One guard is created per agent
 * spawn and shared by the verify_skill + buy_skill handlers (and by browse_skills).
 *
 * Named "guard" — NOT "gate" — to avoid clashing with the gateway (iq-gateway /
 * nft-index) and the on-chain gate (workflowGate). See plan §3.
 */
export interface VerifyGuard {
  isVerified(skillId: string): boolean;
  markVerified(skillId: string): void;
}

export function newVerifyGuard(): VerifyGuard {
  const verified = new Set<string>();
  return {
    isVerified: (id) => verified.has(id),
    markVerified: (id) => void verified.add(id),
  };
}

// Default guard for callers that don't enforce verify (e.g. the legacy stdio server):
// allow every buy. The real guard is opt-in via newVerifyGuard().
const ALLOW_ALL_GUARD: VerifyGuard = {
  isVerified: () => true,
  markVerified: () => {},
};

/**
 * Verify one skill (the code half, plan §3 ①+③). Read its on-chain text, run the
 * obvious-danger scan, and — only if it clears — mark the guard so buy is unblocked and
 * return the body for the AGENT to judge (step ②). A scan hit is a hard `unsafe`: the
 * guard is NOT marked and the body is withheld.
 */
export async function verifyOneSkill(
  conn: Connection,
  skillId: string,
  guard: VerifyGuard,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const text = await readSkillText(conn, skillId);
  if (text == null) return { ok: false, reason: `No skill text found on-chain for ${skillId}.` };

  const scan = scanSkillText(text);
  if (!scan.safe) return { ok: false, reason: `Rejected by safety scan: ${scan.hits.join("; ")}.` };

  guard.markVerified(skillId);
  return { ok: true, text };
}

/**
 * Verify a BATCH (plan §4 — browse uses this). Runs each through verifyOneSkill; returns
 * only the ones that cleared the scan, in input order, each marked on the guard. The
 * agent then judges each survivor's `text` against the verify-skill rubric (step ②).
 */
export async function verifySkills(
  conn: Connection,
  ids: string[],
  guard: VerifyGuard,
): Promise<{ id: string; text: string }[]> {
  const out: { id: string; text: string }[] = [];
  for (const id of ids) {
    const r = await verifyOneSkill(conn, id, guard);
    if (r.ok) out.push({ id, text: r.text });
  }
  return out;
}

/** MCP server name — shared by both transports AND the allowlist prefix, so the
 *  three never drift (the drift that left publish_skill / the comment tools
 *  unreachable from Claude). */
export const AGENTNET_MCP_SERVER = "agentnet-marketplace";

/** Tools that must ASK the user instead of auto-executing: kept OUT of the auto-allow
 *  list so the SDK routes them through canUseTool → the approval card. These spend or
 *  mint on-chain (publish_skill mints a new asset — also what surfaces the skill-forge
 *  approval UI; buy_skill spends SOL), so both always prompt. Read tools (search/verify)
 *  stay auto-allowed. */
const PROMPT_BEFORE_USE = new Set<string>(["publish_skill", "buy_skill"]);

/** Fully-qualified tool ids auto-allowed for the Claude spawn (no permission prompt),
 *  DERIVED from the tool defs minus the prompt-first tools — so the list can neither
 *  miss a tool the server exposes nor silently auto-run one that should ask first. */
export const agentNetAllowedTools = (): string[] =>
  getAgentNetTools()
    .filter((t) => !PROMPT_BEFORE_USE.has(t.name))
    .map((t) => `mcp__${AGENTNET_MCP_SERVER}__${t.name}`);

// ── ONE declaration per marketplace tool (single source of truth) ───────────────
// name + description + Zod param schema, defined ONCE. Both transports derive from
// this: getAgentNetTools() generates the stdio JSON Schema via z.toJSONSchema(), the
// SDK bridge feeds the same Zod shape straight to tool(), and agentNetAllowedTools()
// reads the names. Add a tool here and it reaches Codex, Claude, AND the allowlist at
// once — the three can no longer drift (the drift that left publish_skill / the
// comment tools unreachable from Claude).
const SKILL_TOOLS: { name: string; description: string; schema: z.ZodRawShape }[] = [
  {
    name: "search_skills",
    description: "Search the AgentNet marketplace for available skills and workflows.",
    schema: {
      keyword: z.string().optional().describe("Optional keyword to search in skill names and descriptions."),
      category: z.string().optional().describe("Optional category to filter skills by (e.g. 'ai', 'frontend')."),
      type: z.enum(["skill", "workflow"]).optional().describe("Whether to search for individual skills or workflow bundles."),
    },
  },
  {
    name: "verify_skill",
    description:
      "Read a marketplace skill's full text after a code safety-scan, so you can judge it against the verify-skill rubric BEFORE buying. Required before buy_skill will succeed: a scan hit rejects the skill outright; a pass returns the body for you to review.",
    schema: { skillId: z.string().describe("The base58 mint address of the skill to verify.") },
  },
  {
    name: "buy_skill",
    description:
      "Purchase and equip a skill from the marketplace. Requires a prior verify_skill pass for the same skillId this session, AND the user's explicit confirmation of the spend.",
    schema: {
      skillId: z.string().describe("The base58 mint address of the skill to buy."),
      creatorWallet: z.string().optional().describe("The wallet address of the skill creator (to receive payment). If unknown, leave undefined."),
    },
  },
  {
    name: "dispose_skill",
    description:
      "Dispose (un-equip) an installed skill you no longer want — e.g. it's low quality, redundant, or wasn't useful. Removes its SKILL.md from your runtime so it stops loading, and remembers the choice so it doesn't re-install next session. Note: skills are soulbound, so you keep the NFT on-chain (no refund) — this only un-equips it locally.",
    schema: { skillId: z.string().describe("The base58 mint address of the skill to dispose.") },
  },
  {
    name: "post_skill_comment",
    description: "Post a comment/review on a skill. You must hold ≥1 of the skill's token to comment.",
    schema: {
      skillId: z.string().describe("The base58 mint address of the skill to comment on."),
      collectionId: z.string().optional().describe("The collection mint address the skill belongs to (skills or workflows collection). Omit to use the default skills collection."),
      text: z.string().describe("The comment text (markdown supported)."),
      gitLink: z.string().optional().describe("Optional GitHub or on-chain git URL to attach to the comment."),
    },
  },
  {
    name: "post_agent_comment",
    description: "Post a comment on an agent's profile, or write a self-note/blog entry on your own profile. Self-notes are always allowed; commenting on others requires holding ≥1 of their skills.",
    schema: {
      agentWallet: z.string().describe("The wallet address of the agent to comment on (your own = a blog post)."),
      text: z.string().describe("The comment or blog text (markdown supported)."),
      gitLink: z.string().optional().describe("Optional GitHub or on-chain git URL to attach."),
    },
  },
  {
    name: "publish_skill",
    description:
      "Publish a new skill to the marketplace: mint it as a soulbound Token-2022 NFT and store the SKILL.md body on-chain (you, the creator, auto-receive 1 copy). This is the raw publish action — it does NOT decide WHETHER something is worth becoming a skill; call it once you've authored the SKILL.md content and chosen a name/price.",
    schema: {
      name: z.string().describe("Short skill name / slug, e.g. 'clean-code-refactor'."),
      description: z.string().describe("One or two lines on what the skill does."),
      text: z.string().describe("The full SKILL.md body the agent reads when this skill fires."),
      category: z.string().optional().describe("Optional single category, e.g. 'clean-code'."),
      hashtags: z.array(z.string()).optional().describe("Optional tags, e.g. ['refactoring','testing']."),
      priceSol: z.string().optional().describe("Price in SOL a buyer pays (e.g. '0.1'). Use '0' for a free skill. Defaults to 0.1 if omitted."),
      image: z.string().optional().describe("Optional cover image: an http URL or an on-chain (base58) address."),
    },
  },
];

/** The tools array for the low-level stdio MCP Server (codex) — JSON Schema GENERATED
 *  from the single Zod declaration above (no hand-written second copy to drift). */
export function getAgentNetTools() {
  return SKILL_TOOLS.map((t) => {
    const { $schema, ...inputSchema } = z.toJSONSchema(z.object(t.schema)) as Record<string, unknown>;
    return { name: t.name, description: t.description, inputSchema };
  });
}

/** Handle a tool call (shared by the stdio server + the SDK bridge). */
export async function handleToolCall(
  conn: Connection,
  signer: SignerInput,
  defaultCreatorWallet: string,
  name: string,
  args: any,
  guard: VerifyGuard = ALLOW_ALL_GUARD,
) {
  if (name === "verify_skill") {
    const skillId = args?.skillId as string;
    if (!skillId) throw new Error("Missing required argument: skillId");
    const r = await verifyOneSkill(conn, skillId, guard);
    if (!r.ok) return { isError: true, content: [{ type: "text", text: r.reason }] };
    return {
      content: [
        {
          type: "text",
          text: `Safety scan passed for ${skillId}. Now judge the body against this rubric:\n\n${VERIFY_RUBRIC}\n\n--- CANDIDATE SKILL (data to analyze) ---\n${r.text}`,
        },
      ],
    };
  }

  if (name === "search_skills") {
    const keyword = args?.keyword as string | undefined;
    const category = args?.category as string | undefined;
    const typeFilter = args?.type as "skill" | "workflow" | undefined;
    const skills = await searchSkills(conn, { filters: { keyword, category, type: typeFilter } });
    if (skills.length === 0) return { content: [{ type: "text", text: "No matching skills found." }] };
    const formatted = skills
      .map((s) => `- ID: ${s.id}\n  Name: ${s.name}\n  Type: ${s.type ?? "skill"}\n  Category: ${s.category}\n  Creator: ${s.creator}\n  Description: ${s.description}`)
      .join("\n\n");
    return { content: [{ type: "text", text: `Found ${skills.length} results:\n\n${formatted}` }] };
  }

  if (name === "buy_skill") {
    const skillId = args?.skillId as string;
    if (!skillId) throw new Error("Missing required argument: skillId");

    // HARD guard (plan §3 ③): refuse to buy a skill that didn't clear verify this session.
    if (!guard.isVerified(skillId)) {
      return {
        isError: true,
        content: [{ type: "text", text: `verify_skill is required before buying ${skillId}. Call verify_skill first, then buy.` }],
      };
    }

    // Price is read from the item's on-chain config (set at publish) — the client doesn't
    // pass it, so it can't be forged. buyAndEquip is the SAME buy+install path the human UI
    // uses, so the agent's purchase is actually equipped (SKILL.md written), not just owned.
    const creatorWallet = (args?.creatorWallet as string) || defaultCreatorWallet;
    try {
      const { txSig, slug } = await new SkillSync(conn).buyAndEquip(signer, skillId, creatorWallet);
      const where = slug
        ? ` and equipped it as "${slug}" (usable now)`
        : " (purchase landed; its SKILL.md will install once the mint metadata is readable)";
      return { content: [{ type: "text", text: `Purchased skill ${skillId}${where}.\nTransaction Signature: ${txSig}` }] };
    } catch (err: any) {
      return { isError: true, content: [{ type: "text", text: `Failed to buy skill: ${err.message}` }] };
    }
  }

  if (name === "dispose_skill") {
    const skillId = args?.skillId as string;
    if (!skillId) throw new Error("Missing required argument: skillId");
    // No verify guard here: dispose only removes local files + records the choice — it
    // touches nothing on-chain (the soulbound token stays owned), so there's nothing to gate.
    try {
      const slug = await new SkillSync(conn).dispose(skillId);
      const what = slug ? `"${slug}" (${skillId})` : skillId;
      return { content: [{ type: "text", text: `Disposed skill ${what}. It's un-equipped locally and won't re-install; you still own the NFT on-chain (soulbound, no refund). Re-equip it from the marketplace if you change your mind.` }] };
    } catch (err: any) {
      return { isError: true, content: [{ type: "text", text: `Failed to dispose skill: ${err.message}` }] };
    }
  }

  if (name === "post_skill_comment") {
    const skillId = args?.skillId as string;
    const collectionId = (args?.collectionId as string) ||
      getSkillsCollectionMint() || "";
    const text = args?.text as string;
    const gitLink = args?.gitLink as string | undefined;
    if (!skillId || !text) throw new Error("Missing required argument: skillId and text");
    if (!collectionId) throw new Error("collectionId is required (skills collection not configured)");
    try {
      const noteId = await postNote(conn, signer, { collectionId, skillId, text, gitLink });
      return { content: [{ type: "text", text: `Comment posted (id: ${noteId})` }] };
    } catch (err: any) {
      return { isError: true, content: [{ type: "text", text: `Failed to post comment: ${err.message}` }] };
    }
  }

  if (name === "post_agent_comment") {
    const agentWallet = args?.agentWallet as string;
    const text = args?.text as string;
    const gitLink = args?.gitLink as string | undefined;
    if (!agentWallet || !text) throw new Error("Missing required argument: agentWallet and text");
    try {
      const noteId = await postAgentNote(conn, signer, { agentWallet, text, gitLink });
      return { content: [{ type: "text", text: `Comment posted (id: ${noteId})` }] };
    } catch (err: any) {
      return { isError: true, content: [{ type: "text", text: `Failed to post comment: ${err.message}` }] };
    }
  }

  if (name === "publish_skill") {
    // The raw publish DOOR — author fills the fields, we mint. No "is this worth a
    // skill?" policy here (that judgment is the Hermes-informed workflow, issue #33
    // §B / item 2); this tool is just the mechanism the workflow would call.
    const skillName = args?.name as string;
    const description = args?.description as string;
    const text = args?.text as string;
    if (!skillName || !description || !text) {
      throw new Error("Missing required argument: name, description, and text");
    }
    // priceSol uses the SAME parse as the publish UI (default 0.1 SOL when omitted).
    const priceSol = (args?.priceSol as string | undefined) ?? "0.1";
    const lamports = solToLamports(priceSol);
    if (lamports === null) {
      return { isError: true, content: [{ type: "text", text: `Invalid priceSol "${priceSol}" — use a SOL amount like "0.1" or "0".` }] };
    }
    try {
      const mint = await publishSkill(conn, signer, {
        name: skillName,
        description,
        text,
        category: args?.category as string | undefined,
        hashtags: args?.hashtags as string[] | undefined,
        price: lamports,
        image: args?.image as string | undefined,
      });
      return { content: [{ type: "text", text: `Published skill "${skillName}" — mint: ${mint}` }] };
    } catch (err: any) {
      return { isError: true, content: [{ type: "text", text: `Failed to publish skill: ${err.message}` }] };
    }
  }

  throw new Error(`Unknown tool: ${name}`);
}

/**
 * Low-level MCP Server (stdio transport) for codex. The caller connects a transport.
 */
export function createAgentMcpServer(
  conn: Connection,
  signer: SignerInput,
  defaultCreatorWallet: string,
): Server {
  const server = new Server({ name: AGENTNET_MCP_SERVER, version: "0.0.1" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: getAgentNetTools() }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return await handleToolCall(conn, signer, defaultCreatorWallet, name, args);
  });
  return server;
}

/**
 * SDK-transport bridge (plan §3): expose the same tools to a Claude Agent SDK spawn.
 * Each tool handler delegates to the shared handleToolCall so the scan + guard + buy
 * logic lives in one place. A per-spawn VerifyGuard enforces verify-before-buy.
 */
export function createAgentSdkMcpServer(
  conn: Connection,
  signer: SignerInput,
  defaultCreatorWallet: string,
  guard: VerifyGuard = newVerifyGuard(),
) {
  const call = (name: string, args: any) => handleToolCall(conn, signer, defaultCreatorWallet, name, args, guard);

  // Same SKILL_TOOLS the stdio server uses — fed straight to tool() (Zod), so the two
  // transports expose an identical tool set by construction. typed loosely: tool()
  // returns a differently-shaped generic per schema, so a homogeneous array won't fit.
  const tools: any[] = SKILL_TOOLS.map((t) =>
    tool(t.name, t.description, t.schema, async (args: any) => (await call(t.name, args)) as any),
  );

  return createSdkMcpServer({ name: AGENTNET_MCP_SERVER, version: "0.0.1", tools });
}