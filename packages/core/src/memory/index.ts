// Shared-memory orchestrator (issue #18) — the memory analog of runtime/inject's
// session resume. Ties the three seams together:
//   Drive (MemoryStore, encrypted) ⇄ canonical ⇄ per-runtime files (convert/*)
//
// Two directions, wired into the runtime around a session (see runtime/index.ts):
//   • injectAtStart(cli, cwd): pull canonical from Drive and write it into the CLI's
//     native memory location BEFORE the CLI starts, so it loads on this run.
//   • captureFromClaude(cwd): after Claude turns, read its memory dir back into
//     canonical, merge, and push to Drive. (Stock Codex never writes memory, so
//     there is no Codex capture — verified; see plans/shared-memory.md.)

import type { StorageAdapter, Wallet } from "../runtime/contract.js";
import { MemoryStore } from "./store.js";
import { readClaudeMemory, writeClaudeMemory } from "./convert/claude.js";
import { writeCodexMemory } from "./convert/codex.js";
import type { CanonicalMemory, MemoryRecord } from "./types.js";

type Cli = "claude" | "codex";

// Merge two canonical sets by record name; newest updatedAt wins on conflict. Used
// to fold freshly-captured Claude records onto what's already in Drive (and to keep
// records that only exist on one side).
export function mergeMemory(
  base: CanonicalMemory,
  incoming: CanonicalMemory,
): CanonicalMemory {
  const byName = new Map<string, MemoryRecord>();
  for (const r of base.records) byName.set(r.name, r);
  for (const r of incoming.records) {
    const prev = byName.get(r.name);
    if (!prev || r.updatedAt >= prev.updatedAt) byName.set(r.name, r);
  }
  return { version: 1, records: [...byName.values()] };
}

export class MemorySync {
  private store: MemoryStore;

  constructor(wallet: Wallet, storage: StorageAdapter) {
    this.store = new MemoryStore(wallet, storage);
  }

  // INJECT: write the project's canonical memory into the target CLI's native files
  // before it starts. No-op-safe when memory is empty (writes an empty index/block).
  async injectAtStart(cli: Cli, cwd: string): Promise<void> {
    const mem = await this.store.load(cwd);
    if (cli === "claude") await writeClaudeMemory(cwd, mem);
    else await writeCodexMemory(cwd, mem);
  }

  // CAPTURE: fold Claude's on-disk memory back into Drive. Reads the dir, merges onto
  // the stored canonical (newest wins), and persists if anything changed. Returns the
  // merged canonical so callers can re-inject the other runtime if they want.
  async captureFromClaude(cwd: string): Promise<CanonicalMemory> {
    const [stored, onDisk] = await Promise.all([
      this.store.load(cwd),
      readClaudeMemory(cwd),
    ]);
    const merged = mergeMemory(stored, onDisk);
    if (JSON.stringify(merged) !== JSON.stringify(stored)) {
      await this.store.save(cwd, merged);
    }
    return merged;
  }
}

export type { CanonicalMemory, MemoryRecord, MemoryType } from "./types.js";
export { MemoryStore } from "./store.js";
