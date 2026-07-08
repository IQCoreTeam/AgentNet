// Canonical → OpenClaw workspace MEMORY.md (plans/soul-memory-portability.md §4).
// Same shape as the Codex converter: OpenClaw loads its workspace MEMORY.md wholesale
// as long-term memory, so we own a fenced block inside it and leave human/agent
// content around it alone. One-way INJECT v1 — capture happens through the
// memory_save vault tool (the tool description teaches save-as-you-learn), and the
// memories/*.md daily notes become a capture source only with the native plugin's
// after_agent_turn hook (later phase).
//
// The "project" for an OpenClaw agent is its workspace dir: memory_save(project=
// workspace) and this inject read/write the SAME canonical blob, so the loop closes.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CanonicalMemory, MemoryRecord } from "../types.js";
import { spliceMarkedBlock } from "./codex.js";

const START = "<!-- agentnet:memory:start -->";
const END = "<!-- agentnet:memory:end -->";

function renderSection(r: MemoryRecord): string {
  return `## ${r.name}\n\n${r.description}\n\n${r.body.trimEnd()}\n`;
}

export function renderOpenclawBlock(mem: CanonicalMemory): string {
  const head = "# Shared memory (managed by AgentNet — do not edit between the markers)";
  const body = mem.records.map(renderSection).join("\n");
  return `${START}\n${head}\n\n${body}${END}\n`;
}

/** Splice the managed block into the workspace's MEMORY.md, preserving everything
 *  outside the markers. No records → no-op (don't create an empty managed block). */
export async function writeOpenclawMemory(workspaceDir: string, mem: CanonicalMemory): Promise<void> {
  if (mem.records.length === 0) return;
  const file = join(workspaceDir, "MEMORY.md");
  let existing = "";
  try {
    existing = await readFile(file, "utf8");
  } catch {
    /* no MEMORY.md yet */
  }
  await writeFile(file, spliceMarkedBlock(existing, renderOpenclawBlock(mem), START, END));
}
