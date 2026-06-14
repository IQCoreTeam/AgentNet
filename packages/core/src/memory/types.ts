// Canonical shared-memory form (issue #18) — the CLI-neutral representation that
// maps to both Claude's per-project frontmatter records and Codex's AGENTS.md, and
// that gets encrypted to the wallet and synced through the StorageAdapter (same path
// as session blobs). Mirrors CanonicalSession in runtime/contract.ts.
//
// Claude is the richer (lossless) shape — discrete records with frontmatter — so the
// canonical record carries that metadata; Codex renders down to markdown sections.
// See plans/shared-memory.md for the format study these fields come from.

export type MemoryType = "user" | "feedback" | "project" | "reference";

export interface MemoryRecord {
  // stable slug — Claude filename (`<name>.md`) and Codex section-heading slug.
  name: string;
  // one-liner — Claude's MEMORY.md index line + the lead line of the Codex section.
  description: string;
  // the fact itself, markdown. May contain [[other-name]] cross-links.
  body: string;
  type: MemoryType;
  // [[name]] cross-references to other records (parsed out of the body).
  links?: string[];
  // provenance: the session that first wrote this record (kept across round-trips).
  originSessionId?: string;
  // last-write wall clock (ms) — used to merge concurrent edits (newest wins).
  updatedAt: number;
}

export interface CanonicalMemory {
  version: 1;
  records: MemoryRecord[];
}

export const emptyMemory = (): CanonicalMemory => ({ version: 1, records: [] });
