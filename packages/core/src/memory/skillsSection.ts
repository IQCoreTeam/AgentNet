// "Your skills" memory section — a managed, auto-updated block that tells the
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
// just the filesystem, the same readdir the "owned skills" panel uses), render
// skill names plus one-line descriptions, and splice them into:
//   - claude: the project memory index (MEMORY.md)
//   - codex:  the repo AGENTS.md
// Both already get our other managed blocks; we own ONLY between the markers and
// leave everything else (human notes, synced memory) untouched.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { claudeSkillsDir, claudeMemoryDir, codexAgentsFile } from "../core/paths.js";
import { spliceMarkedBlock } from "./convert/codex.js";

const START = "<!-- agentnet:skills:start -->";
const END = "<!-- agentnet:skills:end -->";

export interface InstalledSkillSummary {
  name: string;
  description?: string;
}

function parseFrontmatterScalar(skillMd: string, key: "name" | "description"): string | undefined {
  const lines = skillMd.replace(/^﻿/, "").split("\n");
  if (!lines[0]?.trim().startsWith("---")) return undefined;
  const closeIdx = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (closeIdx === -1) return undefined;

  for (let i = 1; i < closeIdx; i++) {
    const m = lines[i].match(/^([A-Za-z0-9_.-]+):[ \t]*(.*)$/);
    if (!m || m[1] !== key) continue;
    const raw = m[2].trim();
    if (!raw) return undefined;
    if (/^[|>][+-]?$/.test(raw)) {
      const block: string[] = [];
      for (let j = i + 1; j < closeIdx; j++) {
        if (/^\s+\S/.test(lines[j])) block.push(lines[j].trim());
        else break;
      }
      return block.join(" ").replace(/\s+/g, " ").trim() || undefined;
    }
    return raw.replace(/^['"]|['"]$/g, "").replace(/\s+/g, " ").trim() || undefined;
  }
  return undefined;
}

async function readSkillSummary(dirName: string): Promise<InstalledSkillSummary> {
  try {
    const body = await readFile(join(claudeSkillsDir(), dirName, "SKILL.md"), "utf8");
    return {
      name: parseFrontmatterScalar(body, "name") ?? dirName,
      description: parseFrontmatterScalar(body, "description"),
    };
  } catch {
    return { name: dirName };
  }
}

/** Read installed skill metadata from the local skills dir (one subdir per skill).
 *  Pure filesystem, no RPC. Both runtimes install the same SKILL.md, so claude's
 *  dir is the single read. Returns [] when nothing is installed (or the dir is
 *  missing) — the caller then writes an empty/cleared block. */
export async function installedSkillSummaries(): Promise<InstalledSkillSummary[]> {
  try {
    const entries = await readdir(claudeSkillsDir(), { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    const summaries = await Promise.all(dirs.map(readSkillSummary));
    return summaries.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** The managed block names installed skills and includes their trigger descriptions, so
 *  the agent knows what each skill does and when to reach for it. The full SKILL.md body
 *  stays in the skills dir (read on demand). Empty list → a block that says so (keeps
 *  the markers present and idempotent). */
function renderBlock(skills: InstalledSkillSummary[]): string {
  const line = skills.length
    ? [
        "The following skills are installed and ready. Use one when it fits the task:",
        ...skills.map((s) => s.description ? `- ${s.name}: ${s.description}` : `- ${s.name}`),
      ].join("\n")
    : "No skills are installed yet.";
  return `${START}\n${line}\n${END}`;
}

/** The memory file a runtime's managed blocks live in: claude's MEMORY.md index in the
 *  project memory dir, or codex's repo AGENTS.md. Shared by every managed-block updater
 *  (skills, preview) so the cli -> file mapping has one source of truth. */
export function memoryFileFor(cli: "claude" | "codex", cwd: string): string {
  return cli === "claude" ? join(claudeMemoryDir(cwd), "MEMORY.md") : codexAgentsFile(cwd);
}

/** Splice (replace-or-append) a marker-delimited block into a file, preserving everything
 *  outside the markers. Creates the file if missing. An empty block whose markers are not
 *  already present is a no-op: never create or dirty a file just to write nothing. Shared
 *  by every managed-block updater (skills, preview) so there is one splicer, not two. */
export async function spliceIntoFile(file: string, block: string, start: string, end: string): Promise<void> {
  let existing = "";
  try {
    existing = await readFile(file, "utf8");
  } catch {
    /* file doesn't exist yet — spliceMarkedBlock returns the block alone */
  }
  if (!block && !existing.includes(start)) return;
  await writeFile(file, spliceMarkedBlock(existing, block, start, end));
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
export async function updateSkillsSection(cli: "claude" | "codex", cwd: string): Promise<InstalledSkillSummary[]> {
  try {
    const skills = await installedSkillSummaries();
    await spliceIntoFile(memoryFileFor(cli, cwd), renderBlock(skills), START, END);
    return skills;
  } catch {
    /* never throw from skill-section sync */
    return [];
  }
}
