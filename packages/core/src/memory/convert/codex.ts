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

// Splice the managed block into existing AGENTS.md text: replace an existing block,
// else append one. Content outside the markers is preserved verbatim.
export function spliceCodexBlock(existing: string, block: string): string {
  const s = existing.indexOf(START);
  const e = existing.indexOf(END);
  if (s >= 0 && e > s) {
    const before = existing.slice(0, s);
    const after = existing.slice(e + END.length).replace(/^\n/, "");
    return `${before}${block}${after}`;
  }
  if (existing.trim() === "") return block;
  return `${existing.replace(/\n*$/, "")}\n\n${block}`;
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
