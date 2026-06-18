// Standalone stdio MCP server — the entry Codex spawns as a child process.
//
// Claude gets the marketplace tools IN-PROCESS (createAgentSdkMcpServer shares the
// extension's loaded wallet). Codex can't: its `codex app-server` is a separate
// binary that loads MCP servers from config as child processes (`command`/`args`).
// So this process must bootstrap its OWN wallet + RPC from disk — the same sequence
// a surface uses (localWallet → resolveRpcUrl → initChain) — then expose the tools
// over stdio. Reuses createAgentMcpServer; no new tool logic here.
//
// Phase 1 is READ-ONLY: { readOnly: true } registers only search/verify. The
// write/spend tools (buy/publish/comment/unequip) aren't exposed at all, so there is
// no approval channel to bypass. Trading turns on in Phase 2, once Codex's MCP-tool
// approval is routed to the forge approval card.
//
// IMPORTANT: stdout is the JSON-RPC channel — never write to it. All diagnostics go
// to stderr (console.error).

import { Connection } from "@solana/web3.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveRpcUrl } from "./core/rpc.js";
import { init as initChain } from "./core/chain.js";
import { localWallet } from "./account/localWallet.js";
import { createAgentMcpServer } from "./skill-market/index.js";

async function main(): Promise<void> {
  const { wallet, address } = await localWallet();
  const conn = new Connection(await resolveRpcUrl(), "confirmed");
  initChain(conn); // writes go through chain.ts's singleton; idempotent
  const server = createAgentMcpServer(conn, wallet, address, { readOnly: true });
  await server.connect(new StdioServerTransport());
  console.error(`[agentnet-mcp] ready (read-only) — wallet ${address}`);
}

main().catch((err) => {
  console.error(`[agentnet-mcp] failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
