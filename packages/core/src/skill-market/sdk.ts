// Claude Agent SDK bridge for the marketplace tools — split out of index.ts so the
// vendor-neutral tool band stays importable WITHOUT @anthropic-ai/claude-agent-sdk
// (issue #84's "one entanglement to cut"): the stdio entry and its npm bundle pull
// index.ts only; this wrapper is used solely by our own runtime's in-process Claude
// spawn.

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { Connection } from "@solana/web3.js";
import type { SignerInput } from "@iqlabs-official/solana-sdk/utils";
import {
  AGENTNET_MCP_SERVER,
  SKILL_TOOLS,
  handleToolCall,
  newVerifyGuard,
  type VerifyGuard,
  type MarketEmit,
} from "./index.js";

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
  onMarketEvent?: MarketEmit,
) {
  const call = (name: string, args: any) => handleToolCall(conn, signer, defaultCreatorWallet, name, args, guard, onMarketEvent);

  // Same SKILL_TOOLS the stdio server uses — fed straight to tool() (Zod), so the two
  // transports expose an identical tool set by construction. typed loosely: tool()
  // returns a differently-shaped generic per schema, so a homogeneous array won't fit.
  const tools: any[] = SKILL_TOOLS.map((t) =>
    tool(t.name, t.description, t.schema, async (args: any) => (await call(t.name, args)) as any),
  );

  return createSdkMcpServer({ name: AGENTNET_MCP_SERVER, version: "0.0.1", tools });
}