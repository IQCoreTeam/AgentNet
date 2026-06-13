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
    
    const priceVal = args?.price as number | undefined;
    const price = priceVal !== undefined ? BigInt(Math.floor(priceVal)) : 0n;
    
    const creatorWallet = (args?.creatorWallet as string) || defaultCreatorWallet;
    const buyerWallet = await signerAddress(signer);

    try {
      const txSig = await buySkill(conn, signer, {
        skillId,
        buyerWallet,
        creatorWallet,
        price,
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
