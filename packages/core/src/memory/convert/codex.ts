// Canonical → Codex AGENTS.md (issue #18). One-way INJECT only: verified that stock
// codex (codex-cli 0.139.0) reads AGENTS.md at session start but never writes memory
// itself, and that a global + repo AGENTS.md are concatenated — so we own a fenced
// block inside the repo's AGENTS.md and leave any human-authored content alone.
// See plans/shared-memory.md (Codex live probes).
//
// Codex has no per-record structure, so each canonical record renders to a `##`
// section (description as the lead line, body below). We don't parse this back —
// Claude is the source of truth for capture.

import { readFile, writeFile } from "node:fs/promises";
import { codexAgentsFile } from "../../core/paths.js";
import type { CanonicalMemory, MemoryRecord } from "../types.js";

const START = "<!-- agentnet:memory:start -->";
const END = "<!-- agentnet:memory:end -->";

function renderSection(r: MemoryRecord): string {
  return `## ${r.name}\n\n${r.description}\n\n${r.body.trimEnd()}\n`;
}

// The managed block (between the markers). Regenerated wholesale each sync.
export function renderCodexBlock(mem: CanonicalMemory): string {
  const head =
    "# Shared memory (managed by AgentNet — do not edit between the markers)";
  const body = mem.records.map(renderSection).join("\n");
  return `${START}\n${head}\n\n${body}${END}\n`;
}

// Splice a marker-delimited block into existing text: replace an existing block,
// else append one. Content outside the markers is preserved verbatim. Generic over
// the marker pair so other managed blocks (e.g. the skills directive, issue #21) can
// coexist in the same AGENTS.md with their own distinct markers.
export function spliceMarkedBlock(
  existing: string,
  block: string,
  start: string,
  end: string,
): string {
  const s = existing.indexOf(start);
  const e = existing.indexOf(end);
  if (s >= 0 && e > s) {
    const before = existing.slice(0, s);
    const after = existing.slice(e + end.length).replace(/^\n/, "");
    return `${before}${block}${after}`;
  }
  if (existing.trim() === "") return block;
  return `${existing.replace(/\n*$/, "")}\n\n${block}`;
}

// Splice the managed memory block into existing AGENTS.md text.
export function spliceCodexBlock(existing: string, block: string): string {
  return spliceMarkedBlock(existing, block, START, END);
}

// Write canonical into the cwd's AGENTS.md, preserving any human content.
export async function writeCodexMemory(
  cwd: string,
  mem: CanonicalMemory,
): Promise<void> {
  const file = codexAgentsFile(cwd);
  let existing = "";
  try {
    existing = await readFile(file, "utf8");
  } catch {
    /* no AGENTS.md yet */
  }
  await writeFile(file, spliceCodexBlock(existing, renderCodexBlock(mem)));
}
