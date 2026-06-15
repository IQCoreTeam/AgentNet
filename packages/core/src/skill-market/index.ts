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
import { buySkill } from "../nft/skill.js";
import { readSkillText } from "../nft/token2022.js";
import { signerAddress } from "../core/chain.js";
import { scanSkillText } from "./scan.js";
import { VERIFY_RUBRIC } from "./rubric.js";

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

/** The tools array for the low-level stdio MCP Server (codex). */
export function getAgentNetTools() {
  return [
    {
      name: "search_skills",
      description: "Search the AgentNet marketplace for available skills and workflows.",
      inputSchema: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "Optional keyword to search in skill names and descriptions." },
          category: { type: "string", description: "Optional category to filter skills by (e.g. 'ai', 'frontend')." },
          type: { type: "string", enum: ["skill", "workflow"], description: "Whether to search for individual skills or workflow bundles." },
        },
      },
    },
    {
      name: "verify_skill",
      description:
        "Read a marketplace skill's full text after a code safety-scan, so you can judge it against the verify-skill rubric BEFORE buying. Required before buy_skill will succeed: a scan hit rejects the skill outright; a pass returns the body for you to review.",
      inputSchema: {
        type: "object",
        properties: { skillId: { type: "string", description: "The base58 mint address of the skill to verify." } },
        required: ["skillId"],
      },
    },
    {
      name: "buy_skill",
      description:
        "Purchase and equip a skill from the marketplace. Requires a prior verify_skill pass for the same skillId this session, AND the user's explicit confirmation of the spend.",
      inputSchema: {
        type: "object",
        properties: {
          skillId: { type: "string", description: "The base58 mint address of the skill to buy." },
          creatorWallet: { type: "string", description: "The wallet address of the skill creator (to receive payment). If unknown, leave undefined." },
        },
        required: ["skillId"],
      },
    },
  ];
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
    // pass it, so it can't be forged.
    const creatorWallet = (args?.creatorWallet as string) || defaultCreatorWallet;
    const buyerWallet = await signerAddress(signer);
    try {
      const txSig = await buySkill(conn, signer, { skillId, buyerWallet, creatorWallet });
      return { content: [{ type: "text", text: `Successfully purchased and equipped skill ${skillId}.\nTransaction Signature: ${txSig}` }] };
    } catch (err: any) {
      return { isError: true, content: [{ type: "text", text: `Failed to buy skill: ${err.message}` }] };
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
  const server = new Server({ name: "agentnet-marketplace", version: "0.0.1" }, { capabilities: { tools: {} } });
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

  // typed loosely: tool() returns a differently-shaped generic per input schema, so a
  // homogeneous array type doesn't fit — createSdkMcpServer accepts the mixed list.
  const tools: any[] = [
    tool(
      "search_skills",
      "Search the AgentNet marketplace for available skills and workflows.",
      {
        keyword: z.string().optional().describe("Keyword to search in names/descriptions."),
        category: z.string().optional().describe("Category filter (e.g. 'ai', 'frontend')."),
        type: z.enum(["skill", "workflow"]).optional().describe("Search skills or workflow bundles."),
      },
      async (args) => (await call("search_skills", args)) as any,
    ),
    tool(
      "verify_skill",
      "Read a skill's full text after a code safety-scan, to judge it against the verify-skill rubric BEFORE buying. Required before buy_skill; a scan hit rejects it, a pass returns the body for you to review.",
      { skillId: z.string().describe("The base58 mint address of the skill to verify.") },
      async (args) => (await call("verify_skill", args)) as any,
    ),
    tool(
      "buy_skill",
      "Purchase and equip a skill. Requires a prior verify_skill pass for the same skillId this session AND the user's explicit confirmation of the spend.",
      {
        skillId: z.string().describe("The base58 mint address of the skill to buy."),
        creatorWallet: z.string().optional().describe("The creator's wallet (to receive payment). Leave undefined if unknown."),
      },
      async (args) => (await call("buy_skill", args)) as any,
    ),
  ];

  return createSdkMcpServer({ name: "agentnet-marketplace", version: "0.0.1", tools });
}