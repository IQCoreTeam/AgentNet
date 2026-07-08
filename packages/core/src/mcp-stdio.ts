// Standalone stdio MCP server — the entry an EXTERNAL HOST spawns as a child process.
//
// Two kinds of host use this today (issue #84 §B piece 1):
//   • Codex: its `codex app-server` loads MCP servers from config as child processes, so
//     the in-process createAgentSdkMcpServer route (Claude) doesn't apply.
//   • Foreign runtimes (OpenClaw / Hermes / Eliza via their MCP client config): they spawn
//     this entry, the wallet signs, and the marketplace tools appear as mcp__agentnet__*.
//
// This process bootstraps its OWN wallet + RPC from disk — the same sequence a surface
// uses (localWallet → resolveRpcUrl → initChain) — then exposes the tools over stdio.
// Reuses createAgentMcpServer; no new tool logic here.
//
// Env contract (CONNECT = spawn + sign; there is no login state to tear down):
//   AGENTNET_WALLET_KEYFILE  path to a Solana keypair JSON. Absent → the Solana CLI
//                            default (~/.config/solana/id.json). Missing file → a new
//                            keypair is generated there (never overwrites a valid one).
//   AGENTNET_MCP_READONLY    "0" | "false" turns WRITE/SPEND tools on (buy/publish/
//                            comment/unequip/install). Anything else — including unset —
//                            stays READ-ONLY (search/verify only), so the safe mode is
//                            the default and Codex Phase 1 behavior is unchanged.
//
// Full mode still has floors: a per-process VerifyGuard refuses buy_skill without a
// verify_skill pass this session, and the wallet keyfile itself is the spend ceiling the
// operator chose to expose. (Lamport caps are an open question in #84 §E.)
//
// IMPORTANT: stdout is the JSON-RPC channel — never write to it. All diagnostics go
// to stderr (console.error).

import { Connection } from "@solana/web3.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveRpcUrl } from "./core/rpc.js";
import { init as initChain } from "./core/chain.js";
import { localWallet } from "./account/localWallet.js";
import { login } from "./account/login.js";
import { createAgentMcpServer, newVerifyGuard } from "./skill-market/index.js";
import type { VaultDeps } from "./vault/tools.js";

function readOnlyFromEnv(): boolean {
  const v = (process.env.AGENTNET_MCP_READONLY ?? "").trim().toLowerCase();
  return !(v === "0" || v === "false");
}

async function main(): Promise<void> {
  const keyfile = process.env.AGENTNET_WALLET_KEYFILE?.trim() || undefined;
  const { wallet, address, created } = await localWallet(keyfile);
  if (created) console.error(`[agentnet-mcp] generated a new wallet keypair at ${keyfile ?? "the default path"}`);
  const conn = new Connection(await resolveRpcUrl(), "confirmed");
  initChain(conn); // writes go through chain.ts's singleton; idempotent
  const readOnly = readOnlyFromEnv();

  // Full mode also opens the VAULT band (soul + memory): bind the wallet to storage
  // the same way a surface does — local always on, the configured cloud mirrored on
  // top when this device has one (config.json + tokens). No cloud configured is fine:
  // vault tools work local-only and the mirror picks the cloud up once a surface
  // connects one. Best-effort: a storage failure downgrades to marketplace-only
  // rather than killing the server.
  let vault: VaultDeps | undefined;
  if (!readOnly) {
    try {
      const session = await login(wallet, (s) => {
        if (!s.ok) console.error(`[agentnet-mcp] cloud mirror: ${s.reason} — ${s.error}`);
      });
      vault = { wallet: session.wallet, storage: session.storage };
    } catch (err) {
      console.error(`[agentnet-mcp] vault unavailable (storage init failed): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const server = createAgentMcpServer(conn, wallet, address, { readOnly, guard: newVerifyGuard(), vault });
  await server.connect(new StdioServerTransport());
  console.error(`[agentnet-mcp] ready (${readOnly ? "read-only" : `full${vault ? "+vault" : ""}`}) — wallet ${address}`);
}

main().catch((err) => {
  console.error(`[agentnet-mcp] failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
