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
//   AGENTNET_WALLET_REMOTE   URL of a remote signer endpoint (account/remoteWallet.ts).
//                            When set, that endpoint holds the key and signs; the
//                            keyfile is never read or created. Unset keeps the
//                            keyfile path exactly as before.
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

// FIRST import, above the solana deps: hooks console.warn so bigint-buffer's
// always-firing "Failed to load bindings" line (no native addon in the bundle, the
// pure JS fallback is expected) stops fronting every spawn's stderr. One line only;
// real warnings pass through. See core/quietBigintWarning.ts (issue #187 F2).
import "./core/quietBigintWarning.js";
import { Connection } from "@solana/web3.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveRpcUrl } from "./core/rpc.js";
import { init as initChain } from "./core/chain.js";
import { localWallet } from "./account/localWallet.js";
import { remoteWallet } from "./account/remoteWallet.js";
import { login } from "./account/login.js";
import type { Wallet } from "./runtime/contract.js";
import { createAgentMcpServer, newVerifyGuard } from "./skill-market/index.js";
import type { VaultDeps } from "./vault/tools.js";
import { injectExternalHosts } from "./vault/inject.js";

function readOnlyFromEnv(): boolean {
  const v = (process.env.AGENTNET_MCP_READONLY ?? "").trim().toLowerCase();
  return !(v === "0" || v === "false");
}

async function main(): Promise<void> {
  const remote = process.env.AGENTNET_WALLET_REMOTE?.trim() || undefined;
  const keyfile = process.env.AGENTNET_WALLET_KEYFILE?.trim() || undefined;
  let wallet: Wallet;
  let address: string;
  // AGENTNET_WALLET_REMOTE opts into the out-of-process signer. If it is set but the
  // signer never answers the /pubkey handshake (down, wrong URL, or an env left on by
  // accident), fall back to the local keyfile path rather than failing the spawn. The
  // fallback is loud on stderr so an intentional vault setup is never silently bypassed.
  let signer: { wallet: Wallet; address: string } | undefined;
  if (remote) {
    try {
      signer = await remoteWallet(remote);
      console.error(`[agentnet-mcp] signing through the remote signer at ${remote}`);
    } catch (err) {
      console.error(
        `[agentnet-mcp] remote signer at ${remote} unreachable (${err instanceof Error ? err.message : String(err)}); falling back to the local keyfile`,
      );
    }
  }
  if (signer) {
    ({ wallet, address } = signer);
  } else {
    const loaded = await localWallet(keyfile);
    wallet = loaded.wallet;
    address = loaded.address;
    if (loaded.created) console.error(`[agentnet-mcp] generated a new wallet keypair at ${keyfile ?? "the default path"}`);
  }
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

  // Connect = the outfit follows: reconcile soul + memory into detected hosts' native
  // files (OpenClaw workspace, Eliza character). AFTER connect, best-effort — the
  // tools are the contract; this inject is progressive enhancement.
  if (vault) {
    injectExternalHosts(vault)
      .then((lines) => lines.forEach((l) => console.error(`[agentnet-mcp] ${l}`)))
      .catch((err) => console.error(`[agentnet-mcp] host inject failed: ${err instanceof Error ? err.message : String(err)}`));
  }
}

main().catch((err) => {
  console.error(`[agentnet-mcp] failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
