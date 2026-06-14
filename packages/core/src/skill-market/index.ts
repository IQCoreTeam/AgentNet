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
import { getSolBalance, TX_FEE_BUFFER_LAMPORTS } from "../notes/solBalance.js";

/**
 * Per-session record of which skills passed the reader-side verify step (issue #21).
 * The HARD gate: buy_skill is rejected unless a verify pass for that skillId was
 * recorded this session. One gate is created per agent spawn and shared between the
 * verify_skill and buy_skill tool handlers.
 */
export interface VerifyGate {
  isVerified(skillId: string): boolean;
  markVerified(skillId: string): void;
}

export function newVerifyGate(): VerifyGate {
  const verified = new Set<string>();
  return {
    isVerified: (id) => verified.has(id),
    markVerified: (id) => void verified.add(id),
  };
}

// Default gate for callers that don't enforce verify (e.g. the legacy stdio server):
// allow every buy. The HARD gate is opt-in via newVerifyGate().
const ALLOW_ALL_GATE: VerifyGate = {
  isVerified: () => true,
  markVerified: () => {},
};

/**
 * Create the tools array for the MCP Server.
 */
export function getAgentNetTools() {
  return [
    {
      name: "search_skills",
      description: "Search the AgentNet marketplace for available skills and workflows.",
      inputSchema: {
        type: "object",
        properties: {
          keyword: {
            type: "string",
            description: "Optional keyword to search in skill names and descriptions.",
          },
          category: {
            type: "string",
            description: "Optional category to filter skills by (e.g. 'ai', 'frontend').",
          },
          type: {
            type: "string",
            enum: ["skill", "workflow"],
            description: "Whether to search for individual skills or workflow bundles.",
          },
        },
      },
    },
    {
      name: "wallet_balance",
      description:
        "Read the agent wallet's native SOL balance (lamports). Use this in OFF mode to funds-gate a buy SUGGESTION: only suggest a skill the wallet can afford (price + network fee).",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "verify_skill",
      description:
        "Read a marketplace skill's full text (reader-side, no on-chain audit) so you can assess its format and safety BEFORE buying. You MUST call this for a skill before buy_skill will succeed.",
      inputSchema: {
        type: "object",
        properties: {
          skillId: {
            type: "string",
            description: "The base58 mint address of the skill to verify.",
          },
        },
        required: ["skillId"],
      },
    },
    {
      name: "buy_skill",
      description:
        "Purchase and equip a skill or workflow from the marketplace. Requires a prior verify_skill pass for the same skillId this session.",
      inputSchema: {
        type: "object",
        properties: {
          skillId: {
            type: "string",
            description: "The base58 mint address of the skill to buy.",
          },
          price: {
            type: "number",
            description: "The price of the skill in lamports. Defaults to 0 if not specified.",
          },
          creatorWallet: {
            type: "string",
            description: "The wallet address of the skill creator (to receive payment). If unknown, leave undefined.",
          },
        },
        required: ["skillId"],
      },
    },
  ];
}

/**
 * Handle a tool call request.
 */
export async function handleToolCall(
  conn: Connection,
  signer: SignerInput,
  defaultCreatorWallet: string,
  name: string,
  args: any,
  gate: VerifyGate = ALLOW_ALL_GATE,
) {
  if (name === "verify_skill") {
    const skillId = args?.skillId as string;
    if (!skillId) {
      throw new Error("Missing required argument: skillId");
    }
    const text = await readSkillText(conn, skillId);
    if (text == null) {
      return {
        isError: true,
        content: [{ type: "text", text: `No skill text found on-chain for ${skillId}.` }],
      };
    }
    // Record the pass so buy_skill is unblocked for this skill this session.
    gate.markVerified(skillId);
    return {
      content: [
        {
          type: "text",
          text: `Skill ${skillId} text (review format + safety before buying):\n\n${text}`,
        },
      ],
    };
  }

  if (name === "wallet_balance") {
    const pubkey = await signerAddress(signer);
    const lamports = await getSolBalance(conn, pubkey);
    return {
      content: [
        {
          type: "text",
          text:
            `Wallet SOL balance: ${lamports} lamports (${lamports / 1e9} SOL). ` +
            `A buy needs the skill price + ~${TX_FEE_BUFFER_LAMPORTS} lamports network fee; ` +
            `the 6.9% protocol fee is taken out of the price (not added on top).`,
        },
      ],
    };
  }

  if (name === "search_skills") {
    const keyword = args?.keyword as string | undefined;
    const category = args?.category as string | undefined;
    const typeFilter = args?.type as "skill" | "workflow" | undefined;

    const skills = await searchSkills(conn, {
      filters: { keyword, category, type: typeFilter },
    });

    if (skills.length === 0) {
      return {
        content: [{ type: "text", text: "No matching skills found." }],
      };
    }

    const formatted = skills
      .map(
        (s) =>
          `- ID: ${s.id}\n  Name: ${s.name}\n  Type: ${s.type ?? "skill"}\n  Category: ${s.category}\n  Creator: ${s.creator}\n  Description: ${s.description}`,
      )
      .join("\n\n");

    return {
      content: [{ type: "text", text: `Found ${skills.length} results:\n\n${formatted}` }],
    };
  }

  if (name === "buy_skill") {
    const skillId = args?.skillId as string;
    if (!skillId) {
      throw new Error("Missing required argument: skillId");
    }

    // HARD verify gate (issue #21): refuse to buy a skill whose text wasn't verified
    // this session. The model must call verify_skill first.
    if (!gate.isVerified(skillId)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `verify_skill is required before buying ${skillId}. Call verify_skill first, then buy.`,
          },
        ],
      };
    }

    // Price is read from the item's on-chain config (set at publish) — the client
    // doesn't pass it, so it can't be forged.
    const creatorWallet = (args?.creatorWallet as string) || defaultCreatorWallet;
    const buyerWallet = await signerAddress(signer);

    try {
      const txSig = await buySkill(conn, signer, {
        skillId,
        buyerWallet,
        creatorWallet,
      });

      return {
        content: [
          {
            type: "text",
            text: `Successfully purchased and equipped skill ${skillId}.\nTransaction Signature: ${txSig}`,
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Failed to buy skill: ${err.message}`,
          },
        ],
      };
    }
  }

  throw new Error(`Unknown tool: ${name}`);
}

/**
 * Creates an MCP Server instance that exposes AgentNet capabilities to autonomous agents.
 * The server must be connected to a transport (e.g. StdioServerTransport) by the caller.
 *
 * @param conn Solana RPC connection
 * @param signer The agent's wallet signer (used for executing transactions like buying skills)
 * @param defaultCreatorWallet The default wallet to send creator shares to (if not known)
 */
export function createAgentMcpServer(
  conn: Connection,
  signer: SignerInput,
  defaultCreatorWallet: string,
): Server {
  const server = new Server(
    {
      name: "agentnet-marketplace",
      version: "0.0.1",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: getAgentNetTools(),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return await handleToolCall(conn, signer, defaultCreatorWallet, name, args);
  });

  return server;
}

/**
 * SDK-transport bridge (issue #21 §4): expose the same marketplace tools to a Claude
 * Agent SDK spawn. The SDK's query() wants `mcpServers: { name: { type:'sdk', instance } }`
 * built via createSdkMcpServer + tool(); our low-level createAgentMcpServer (above) stays
 * for Codex/stdio. Each tool handler delegates to the shared handleToolCall so the
 * verify gate + buy logic live in one place.
 *
 * @param gate per-spawn VerifyGate enforcing verify-before-buy (issue #21). Pass
 *   newVerifyGate() to enforce; omit for the allow-all default.
 * @param opts.includeBuy when false (OFF mode), expose only the READ-ONLY tools
 *   (search_skills + wallet_balance) so the agent can price a missing capability and
 *   funds-gate a SUGGESTION, but can never verify/buy. Default true (ON mode).
 */
export function createAgentSdkMcpServer(
  conn: Connection,
  signer: SignerInput,
  defaultCreatorWallet: string,
  gate: VerifyGate = newVerifyGate(),
  opts: { includeBuy?: boolean } = {},
) {
  const includeBuy = opts.includeBuy !== false;
  const call = (name: string, args: any) =>
    handleToolCall(conn, signer, defaultCreatorWallet, name, args, gate);

  // Read-only tools — present in both modes. search_skills + wallet_balance let OFF mode
  // price a candidate and check funds before recommending it (issue #21 funds-gate).
  // (typed loosely: tool() returns a differently-shaped generic per input schema, so a
  // homogeneous array type doesn't fit — createSdkMcpServer accepts the mixed list.)
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
      "wallet_balance",
      "Read the agent wallet's native SOL balance (lamports). Use to funds-gate a buy suggestion.",
      {},
      async (args) => (await call("wallet_balance", args)) as any,
    ),
  ];

  if (includeBuy) {
    tools.push(
      tool(
        "verify_skill",
        "Read a marketplace skill's full text (reader-side, no on-chain audit) to assess format + safety BEFORE buying. Required before buy_skill will succeed.",
        {
          skillId: z.string().describe("The base58 mint address of the skill to verify."),
        },
        async (args) => (await call("verify_skill", args)) as any,
      ),
      tool(
        "buy_skill",
        "Purchase and equip a skill or workflow. Requires a prior verify_skill pass for the same skillId this session.",
        {
          skillId: z.string().describe("The base58 mint address of the skill to buy."),
          creatorWallet: z
            .string()
            .optional()
            .describe("The creator's wallet (to receive payment). Leave undefined if unknown."),
        },
        async (args) => (await call("buy_skill", args)) as any,
      ),
    );
  }

  return createSdkMcpServer({ name: "agentnet-marketplace", version: "0.0.1", tools });
}
