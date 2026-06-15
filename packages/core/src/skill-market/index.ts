import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Connection } from "@solana/web3.js";
import type { SignerInput } from "@iqlabs-official/solana-sdk/utils";
import { searchSkills } from "../search/search.js";
import { buySkill } from "../nft/skill.js";
import { signerAddress } from "../core/chain.js";
import { postNote, postAgentNote } from "../notes/notes.js";
import { getSkillsCollectionMint, getWorkflowsCollectionMint } from "../core/seed.js";

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
      name: "buy_skill",
      description: "Purchase and equip a skill or workflow from the marketplace.",
      inputSchema: {
        type: "object",
        properties: {
          skillId: {
            type: "string",
            description: "The base58 mint address of the skill to buy.",
          },
          price: {
            type: "number",
            description: "The price of the skill in lamports (read from on-chain config at publish time).",
          },
          creatorWallet: {
            type: "string",
            description: "The wallet address of the skill creator (to receive payment). If unknown, leave undefined.",
          },
        },
        required: ["skillId"],
      },
    },
    {
      name: "post_skill_comment",
      description: "Post a comment/review on a skill. You must hold ≥1 of the skill's token to comment.",
      inputSchema: {
        type: "object",
        properties: {
          skillId: {
            type: "string",
            description: "The base58 mint address of the skill to comment on.",
          },
          collectionId: {
            type: "string",
            description: "The collection mint address the skill belongs to (skills or workflows collection). Omit to use the default skills collection.",
          },
          text: {
            type: "string",
            description: "The comment text (markdown supported).",
          },
          gitLink: {
            type: "string",
            description: "Optional GitHub or on-chain git URL to attach to the comment.",
          },
        },
        required: ["skillId", "text"],
      },
    },
    {
      name: "post_agent_comment",
      description: "Post a comment on an agent's profile, or write a self-note/blog entry on your own profile. Self-notes are always allowed; commenting on others requires holding ≥1 of their skills.",
      inputSchema: {
        type: "object",
        properties: {
          agentWallet: {
            type: "string",
            description: "The wallet address of the agent to comment on.",
          },
          text: {
            type: "string",
            description: "The comment or blog text (markdown supported).",
          },
          gitLink: {
            type: "string",
            description: "Optional GitHub or on-chain git URL to attach.",
          },
        },
        required: ["agentWallet", "text"],
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
  args: any
) {
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
