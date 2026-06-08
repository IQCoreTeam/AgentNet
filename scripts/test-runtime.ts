// Smoke test for BOTH CLIs + shared/append session log.
//  1. claude: send a message → capture → append-encrypted → reload
//  2. codex:  same, independently
//  3. shared: a second claude turn on the SAME sessionId appends (no dup file)
// Run: pnpm test:run   (needs claude + codex installed & logged in)

// Isolate test storage in a temp dir so it never pollutes the real ~/.agentnet.
// MUST be set before importing manual.ts (it reads sessionsDir() at module load).
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AGENTNET_HOME = join(tmpdir(), "agentnet-test-" + process.pid);

import nacl from "tweetnacl";
import { createRuntime } from "../src/runtime/index.js";
import { manualStorage } from "../src/account/storage/manual.js";
import { SessionStore } from "../src/account/store.js";
import type { Wallet } from "../src/runtime/contract.js";

const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
const wallet: Wallet = {
  address: "TESTWALLET",
  async signMessage(msg) {
    return nacl.sign.detached(msg, kp.secretKey);
  },
};

const storage = manualStorage();
const runtime = createRuntime(wallet, storage);

async function runTurn(cli: "claude" | "codex", prompt: string, sessionId?: string) {
  const handle = await runtime.startSession({ cli, cwd: process.cwd(), sessionId });
  handle.onMessage((m) => {
    if (m.role === "assistant") console.log(`    [${cli}] ${m.text.slice(0, 100)}`);
  });
  const done = new Promise<void>((resolve) => handle.onTurnEnd(() => resolve()));
  handle.send(prompt);
  await done;
  handle.stop();
  return handle.sessionId;
}

async function main() {
  // 1. claude
  console.log("→ claude turn 1");
  const claudeId = await runTurn("claude", "reply with exactly: hello from agentnet");
  const c1 = await new SessionStore(wallet, storage).load(claudeId);
  console.log(`  reloaded: ${c1?.messages.length} msgs, title="${c1?.title}"`);

  // 2. codex
  console.log("→ codex turn 1");
  const codexId = await runTurn("codex", "reply with exactly: hello from agentnet");
  const x1 = await new SessionStore(wallet, storage).load(codexId);
  console.log(`  reloaded: ${x1?.messages.length} msgs, title="${x1?.title}"`);

  // 3. shared/append: resume the SAME claude session, append a 2nd turn
  console.log("→ claude turn 2 (resume same session, should APPEND)");
  await runTurn("claude", "now reply with exactly: second turn", claudeId);
  const c2 = await new SessionStore(wallet, storage).load(claudeId);
  console.log(`  after 2 turns: ${c2?.messages.length} msgs (expect > ${c1?.messages.length})`);

  const okClaude = (c1?.messages.length ?? 0) > 0;
  const okCodex = (x1?.messages.length ?? 0) > 0;
  const okAppend = (c2?.messages.length ?? 0) > (c1?.messages.length ?? 0);
  console.log(`\n  claude: ${okClaude ? "✅" : "❌"}  codex: ${okCodex ? "✅" : "❌"}  append-grows: ${okAppend ? "✅" : "❌"}`);

  if (okClaude && okCodex && okAppend) console.log("\n✅ PASS — both CLIs capture, encrypt, append, reload.");
  else {
    console.log("\n❌ FAIL");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("test error:", e);
  process.exit(1);
});
