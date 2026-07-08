// Soul ⇄ OpenClaw workspace SOUL.md (plans/soul-memory-portability.md §3C). OpenClaw's
// persona convention IS ours — a free-form SOUL.md — so this converter is a two-way
// file sync, not a render: the vault doc and the file are the same text, and whichever
// side changed more recently wins (last-writer-wins, matching the SoulDoc's merge
// model; the doc's lastWriter stamp keeps the winner attributable).
//
// This is generic over the file path on purpose: OpenClaw's workspace SOUL.md is the
// first caller, but any host that keeps a persona as one markdown file (a future
// Hermes context file) can ride the same sync.

import { readFile, writeFile, stat } from "node:fs/promises";
import type { SoulStore } from "../store.js";

export type SoulSyncAction = "injected" | "captured" | "none";

/**
 * Reconcile the vault soul with a persona file. Text equality first (steady state is
 * a no-op even though writing the file bumped its mtime); otherwise newest wins:
 * file mtime vs the doc's lastWriter.ts.
 *   only file exists → capture (a host-authored soul enters the vault)
 *   only doc exists  → inject
 *   both, file newer → capture;  both, doc newer → inject
 */
export async function syncSoulWithFile(store: SoulStore, file: string): Promise<SoulSyncAction> {
  const doc = await store.load();
  let fileText: string | null = null;
  let fileTs = 0;
  try {
    fileText = await readFile(file, "utf8");
    fileTs = (await stat(file)).mtimeMs;
  } catch {
    /* no file yet */
  }

  if (fileText === null && !doc) return "none";
  if (fileText !== null && doc && fileText.trim() === doc.text.trim()) return "none";

  if (fileText !== null && (!doc || fileTs > doc.lastWriter.ts)) {
    await store.save(fileText);
    return "captured";
  }
  if (doc) {
    await writeFile(file, doc.text.endsWith("\n") ? doc.text : doc.text + "\n");
    return "injected";
  }
  return "none";
}
