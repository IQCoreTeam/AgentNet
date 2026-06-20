// Round-trip test for shared memory (issue #18). No CLIs spawned — exercises the
// three seams directly: Claude memory dir ⇄ canonical ⇄ encrypted Drive blob, and
// canonical → Codex AGENTS.md. Run: pnpm tsx test/test-memory.ts
//
// Isolate all on-disk writes into a temp dir (AGENTNET_HOME + CLAUDE_CONFIG_DIR)
// BEFORE importing anything that resolves paths at module load.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";

const tmp = mkdtempSync(join(tmpdir(), "agentnet-mem-"));
process.env.AGENTNET_HOME = join(tmp, "agentnet");
process.env.CLAUDE_CONFIG_DIR = join(tmp, "claude");

const { testWallet } = await import("../src/account/keypairWallet.js");
const { manualStorage } = await import("../src/account/storage/manual.js");
const { MemoryStore } = await import("../src/memory/store.js");
const { MemorySync, mergeMemory } = await import("../src/memory/index.js");
const claudeConv = await import("../src/memory/convert/claude.js");
const codexConv = await import("../src/memory/convert/codex.js");
const { claudeMemoryDir, codexAgentsFile } = await import("../src/core/paths.js");
import type { CanonicalMemory } from "../src/memory/types.js";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "  ✓" : "  ✗"} ${name}`);
  if (!cond) failures++;
}

const cwd = join(tmp, "proj"); // real temp project dir (Codex writes AGENTS.md here)
mkdirSync(cwd, { recursive: true });
const wallet = testWallet();
const storage = manualStorage();

const sample: CanonicalMemory = {
  version: 1,
  records: [
    {
      name: "git-sdk-evm-port",
      description: "Port on-chain Git SDK to EVM — Phase 5 next",
      body: "Next: port `@iqlabs/git-sdk` to EVM. Reuse [[ethereum-sdk-shape]].",
      type: "project",
      links: ["ethereum-sdk-shape"],
      originSessionId: "62c2f9f5-04c4-4cdf-8459-28e0304a4771",
      updatedAt: 1000,
    },
  ],
};

// 1. Encrypted store round-trip (the Drive path + wallet crypto).
console.log("1. MemoryStore encrypt → decrypt");
const mstore = new MemoryStore(wallet, storage);
await mstore.save(cwd, sample);
const loaded = await mstore.load(cwd);
check("blob decrypts to identical canonical", JSON.stringify(loaded) === JSON.stringify(sample));
check("stored blob is NOT plaintext", !new TextDecoder()
  .decode((await storage.get(`memory__${cwd.replaceAll("/", "-")}`))!)
  .includes("git-sdk-evm-port"));

// 2. canonical → Claude memory dir → back to canonical (lossless on metadata).
console.log("2. Claude memory dir round-trip");
await claudeConv.writeClaudeMemory(cwd, sample);
const dir = claudeMemoryDir(cwd);
check("record file written", readFileSync(join(dir, "git-sdk-evm-port.md"), "utf8").includes("Phase 5 next"));
check("MEMORY.md index written", readFileSync(join(dir, "MEMORY.md"), "utf8").includes("[git-sdk-evm-port]"));
const back = await claudeConv.readClaudeMemory(cwd);
const r = back.records[0];
check("name survives", r?.name === "git-sdk-evm-port");
check("description survives", r?.description === sample.records[0].description);
check("type survives", r?.type === "project");
check("originSessionId survives", r?.originSessionId === sample.records[0].originSessionId);
check("[[links]] re-parsed from body", JSON.stringify(r?.links) === JSON.stringify(["ethereum-sdk-shape"]));

// 3. canonical → Codex AGENTS.md, preserving human content + idempotent re-splice.
console.log("3. Codex AGENTS.md inject preserves human content");
const human = "# My project\n\nHand-written notes I do not want clobbered.\n";
writeFileSync(codexAgentsFile(cwd), human);
await codexConv.writeCodexMemory(cwd, sample);
let agents = readFileSync(codexAgentsFile(cwd), "utf8");
check("human content preserved", agents.includes("Hand-written notes I do not want clobbered"));
check("memory fact injected", agents.includes("git-sdk-evm-port") && agents.includes("Phase 5 next"));
check("fenced block present", agents.includes("agentnet:memory:start") && agents.includes("agentnet:memory:end"));
await codexConv.writeCodexMemory(cwd, sample); // second sync
agents = readFileSync(codexAgentsFile(cwd), "utf8");
check("re-sync does not duplicate the block", agents.split("agentnet:memory:start").length === 2);
check("re-sync keeps human content once", agents.split("Hand-written notes").length === 2);
let rootCwdSkipped = true;
try {
  await codexConv.writeCodexMemory("/", sample);
} catch {
  rootCwdSkipped = false;
}
check("root cwd does not write /AGENTS.md", rootCwdSkipped);

// 4. merge: newest updatedAt wins; disjoint records both kept.
console.log("4. mergeMemory newest-wins");
const older = { version: 1 as const, records: [{ ...sample.records[0], description: "OLD", updatedAt: 1 }] };
const newer = { version: 1 as const, records: [{ ...sample.records[0], description: "NEW", updatedAt: 2 }] };
const extra = { version: 1 as const, records: [{ name: "other", description: "x", body: "y", type: "user" as const, updatedAt: 5 }] };
check("newer description wins", mergeMemory(older, newer).records[0].description === "NEW");
check("older does not overwrite newer", mergeMemory(newer, older).records[0].description === "NEW");
check("disjoint records both kept", mergeMemory(sample, extra).records.length === 2);

// 5. cross-runtime: a fact in Claude format ends up readable in Codex's AGENTS.md.
console.log("5. cross-runtime Claude → Drive → Codex");
const sync = new MemorySync(wallet, storage);
const captured = await sync.captureFromClaude(cwd);   // read claude dir → Drive
check("capture round-trips the Claude record", captured.records.some((x) => x.name === "git-sdk-evm-port"));
await sync.injectAtStart("codex", cwd);                // Drive → codex AGENTS.md
check("fact crossed into Codex AGENTS.md", readFileSync(codexAgentsFile(cwd), "utf8").includes("git-sdk-evm-port"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
