// Cross-CLI resume test: a session born in ONE cli must continue in the OTHER.
//   A. born in claude → resume in codex  → codex must recall the codeword
//   B. born in codex  → resume in claude → claude must recall the codeword
// This exercises inject/ (canonical → native jsonl) + the canonicalId/nativeId split.
// Run: pnpm tsx scripts/test-crosscli.ts   (needs claude + codex installed & logged in)

import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.AGENTNET_HOME = join(tmpdir(), "agentnet-xcli-" + process.pid);

import { createRuntime } from "../src/runtime/index.js";
import { manualStorage } from "../src/account/storage/manual.js";
import { testWallet } from "../src/account/keypairWallet.js";

const wallet = testWallet();
const storage = manualStorage();
const runtime = createRuntime(wallet, storage);

async function runTurn(cli: "claude" | "codex", prompt: string, sessionId?: string) {
  const handle = await runtime.startSession({ cli, cwd: process.cwd(), sessionId });
  let last = "";
  handle.onMessage((m) => {
    if (m.role === "assistant") last = m.text;
  });
  const done = new Promise<void>((resolve) => handle.onTurnEnd(() => resolve()));
  handle.send(prompt);
  await done;
  const id = handle.sessionId;
  handle.stop();
  return { id, reply: last };
}

const WORD = "PURPLE-OTTER";
const ASK = `What is the secret codeword I told you earlier? Reply with ONLY the word.`;

async function direction(born: "claude" | "codex", other: "claude" | "codex") {
  console.log(`\n→ ${born}: establish codeword`);
  const a = await runTurn(born, `Remember this: the secret codeword is ${WORD}. Just acknowledge.`);
  console.log(`  ${born} id=${a.id.slice(0, 8)} reply="${a.reply.slice(0, 60)}"`);

  console.log(`→ ${other}: resume the SAME session, ask for the codeword`);
  const b = await runTurn(other, ASK, a.id);
  console.log(`  ${other} reply="${b.reply.slice(0, 80)}"`);

  const recalled = new RegExp(WORD, "i").test(b.reply);
  console.log(`  ${born}→${other}: ${recalled ? "✅ recalled" : "❌ lost"}`);
  return recalled;
}

async function main() {
  const ab = await direction("claude", "codex");
  const ba = await direction("codex", "claude");
  console.log(`\n  claude→codex: ${ab ? "✅" : "❌"}   codex→claude: ${ba ? "✅" : "❌"}`);
  if (ab && ba) console.log("\n✅ PASS — sessions cross between CLIs.");
  else {
    console.log("\n❌ FAIL — a session did not carry across CLIs.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("test error:", e);
  process.exit(1);
});
