// E2E: full pipeline → REAL codex. Writes a Claude-style memory record, captures it
// to the (local) Drive store, injects into the project's AGENTS.md via MemorySync,
// then the CALLER runs `codex exec` in that cwd to confirm stock codex actually loads
// what our pipeline produced. Prints the project cwd so the shell step can cd there.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";

const tmp = mkdtempSync(join(tmpdir(), "agentnet-e2e-"));
process.env.AGENTNET_HOME = join(tmp, "agentnet");
process.env.CLAUDE_CONFIG_DIR = join(tmp, "claude");

const { testWallet } = await import("../src/account/keypairWallet.js");
const { manualStorage } = await import("../src/account/storage/manual.js");
const { MemorySync } = await import("../src/memory/index.js");
const { writeClaudeMemory } = await import("../src/memory/convert/claude.js");

const cwd = join(tmp, "proj");
mkdirSync(cwd, { recursive: true });
// a human-authored AGENTS.md that must survive
writeFileSync(join(cwd, "AGENTS.md"), "# Proj\n\nDo not delete this human line.\n");

const wallet = testWallet();
const storage = manualStorage();
const sync = new MemorySync(wallet, storage);

// 1. mimic Claude writing a memory record during a session
await writeClaudeMemory(cwd, {
  version: 1,
  records: [{
    name: "deploy-codeword",
    description: "the secret deploy word",
    body: "DEPLOY_CODEWORD is ZEBRA42. This is the canonical shared memory fact.",
    type: "project",
    updatedAt: Date.now(),
  }],
});

// 2. capture Claude dir → Drive, then 3. inject Drive → codex AGENTS.md
await sync.captureFromClaude(cwd);
await sync.injectAtStart("codex", cwd);

console.log(cwd);
