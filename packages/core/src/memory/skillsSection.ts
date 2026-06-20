// "Your skills" memory section — a managed, auto-updated one-liner that tells the
// agent which skills are installed, without the user ever typing a prompt and
// without bloating the system prompt (we keep claude's system prompt vanilla).
//
// Why memory (not the system prompt, not "go look in the folder"):
//   - The system prompt stays exactly what claude code ships with (vanilla) — the
//     skill directive used to live there and made the agent feel off.
//   - Memory is injected EVERY session (MemorySync.injectAtStart), so the agent
//     sees this passively — no need to remember to scan the skills dir itself.
//
// It's a SETTER over a marker-delimited block: read the local skills dir (NO RPC —
// just the filesystem, the same readdir the "owned skills" panel uses), render one
// line of skill titles, and splice it into:
//   - claude: the project memory index (MEMORY.md)
//   - codex:  the repo AGENTS.md
// Both already get our other managed blocks; we own ONLY between the markers and
// leave everything else (human notes, synced memory) untouched.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { claudeSkillsDir, claudeMemoryDir, codexSkillsDir, codexAgentsFile } from "../core/paths.js";
import { spliceMarkedBlock } from "./convert/codex.js";

const START = "<!-- agentnet:skills:start -->";
const END = "<!-- agentnet:skills:end -->";

/** Read installed skill titles from the local skills dir (one subdir per skill).
 *  Pure filesystem, no RPC. Read the active runtime's skills dir so the memory
 *  line points to the exact SKILL.md files that runtime can load. Returns []
 *  when nothing is installed (or the dir is missing). */
async function installedSkillNames(cli: "claude" | "codex"): Promise<string[]> {
  try {
    const dir = cli === "claude" ? claudeSkillsDir() : codexSkillsDir();
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

/** The managed block: a single human-readable line naming the installed skills, so
 *  the agent knows they exist and can reach for them. The full SKILL.md body stays
 *  in the skills dir (read on demand) — we only list titles here. Empty list →
 *  a block that says so (keeps the markers present and idempotent). */
function renderBlock(cli: "claude" | "codex", names: string[]): string {
  const path = cli === "claude" ? "~/.claude/skills/" : "~/.codex/skills/";
  const line = names.length
    ? `The following skills are installed and ready under ${path} — to use a skill, view its instructions in ${path}<skill-name>/SKILL.md: ${names.join(", ")}.`
    : "No skills are installed yet.";
  return `${START}\n${line}\n${END}`;
}

/** Splice (replace-or-append) the skills line into a file, preserving everything
 *  outside our markers. Creates the file if missing. */
async function spliceIntoFile(file: string, block: string): Promise<void> {
  let existing = "";
  try {
    existing = await readFile(file, "utf8");
  } catch {
    /* file doesn't exist yet — spliceMarkedBlock returns the block alone */
  }
  await writeFile(file, spliceMarkedBlock(existing, block, START, END));
}

/**
 * Update the "your skills" section for one runtime. Reads the installed skills
 * (no RPC) and splices the one-line block into that runtime's memory file:
 *   - claude → the MEMORY.md index in the project memory dir
 *   - codex  → the repo AGENTS.md
 *
 * Call this AFTER MemorySync.injectAtStart (which regenerates those files), and
 * again right after a skill is bought/published, so the line always reflects what's
 * installed. Best-effort: a filesystem error is swallowed — a missing skills line
 * must never block a session or a purchase.
 */
export async function updateSkillsSection(cli: "claude" | "codex", cwd: string): Promise<void> {
  try {
    const block = renderBlock(cli, await installedSkillNames(cli));
    const file = cli === "claude" ? join(claudeMemoryDir(cwd), "MEMORY.md") : codexAgentsFile(cwd);
    await spliceIntoFile(file, block);
  } catch {
    /* never throw from skill-section sync */
  }
}
