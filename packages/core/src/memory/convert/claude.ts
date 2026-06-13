// Claude per-project memory dir ⇄ canonical (issue #18). Claude is the source of
// truth: during a session it writes discrete frontmatter `.md` records under
// claudeMemoryDir(cwd) plus a MEMORY.md index. We READ those into canonical
// records (capture) and WRITE canonical back out as the same files (inject), so a
// fact learned in Codex (or on another device) shows up in Claude's memory dir.
//
// Frontmatter here is a small, flat YAML subset (name/description + metadata.{type,
// originSessionId}) — see plans/shared-memory.md — so we parse it directly instead
// of pulling a YAML dep. MEMORY.md is a generated index (one line per record) and is
// rebuilt from the records, never parsed back.

import { readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { claudeMemoryDir, ensureDir } from "../../core/paths.js";
import type { CanonicalMemory, MemoryRecord, MemoryType } from "../types.js";
import { emptyMemory } from "../types.js";

const MEMORY_TYPES: MemoryType[] = ["user", "feedback", "project", "reference"];
const isType = (s: string): s is MemoryType => (MEMORY_TYPES as string[]).includes(s);

// [[name]] cross-links embedded in a record body.
function parseLinks(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\[\[([^\]]+)\]\]/g)) out.add(m[1].trim());
  return [...out];
}

// Split a "---\nfm\n---\nbody" file into its frontmatter lines and body.
function splitFrontmatter(text: string): { fm: string[]; body: string } {
  if (!text.startsWith("---")) return { fm: [], body: text };
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { fm: [], body: text };
  const fm = text.slice(3, end).split("\n").filter((l) => l.trim() !== "");
  const body = text.slice(text.indexOf("\n", end + 1) + 1).replace(/^\n+/, "");
  return { fm, body };
}

// Parse one Claude memory file into a canonical record. `slug` is the filename stem,
// used as the record name when the frontmatter omits it.
export function parseClaudeRecord(slug: string, text: string): MemoryRecord {
  const { fm, body } = splitFrontmatter(text);
  let name = slug;
  let description = "";
  let type: MemoryType = "project";
  let originSessionId: string | undefined;
  let inMeta = false;
  for (const line of fm) {
    const indented = /^\s+/.test(line);
    const [rawKey, ...rest] = line.trim().split(":");
    const key = rawKey.trim();
    const val = rest.join(":").trim();
    if (key === "metadata") { inMeta = true; continue; }
    if (!indented) inMeta = false;
    if (key === "name" && val) name = val;
    else if (key === "description") description = val;
    else if (inMeta && key === "type" && isType(val)) type = val;
    else if (inMeta && key === "originSessionId" && val) originSessionId = val;
  }
  const links = parseLinks(body);
  return {
    name,
    description,
    body: body.trimEnd(),
    type,
    ...(links.length ? { links } : {}),
    ...(originSessionId ? { originSessionId } : {}),
    updatedAt: Date.now(),
  };
}

// Read Claude's memory dir for a project into canonical (capture direction).
// Skips MEMORY.md (it's a generated index, not a record). Missing dir → empty.
export async function readClaudeMemory(cwd: string): Promise<CanonicalMemory> {
  const dir = claudeMemoryDir(cwd);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return emptyMemory();
  }
  const records: MemoryRecord[] = [];
  for (const f of files) {
    if (!f.endsWith(".md") || f === "MEMORY.md") continue;
    const text = await readFile(join(dir, f), "utf8");
    const rec = parseClaudeRecord(f.replace(/\.md$/, ""), text);
    // stamp file mtime so capture merges deterministically (newest wins)
    const { mtimeMs } = await (await import("node:fs/promises")).stat(join(dir, f));
    rec.updatedAt = Math.round(mtimeMs);
    records.push(rec);
  }
  return { version: 1, records };
}

// Render one canonical record back to a Claude memory file (frontmatter + body).
export function renderClaudeRecord(r: MemoryRecord): string {
  const meta = [`  type: ${r.type}`];
  if (r.originSessionId) meta.push(`  originSessionId: ${r.originSessionId}`);
  return (
    `---\n` +
    `name: ${r.name}\n` +
    `description: ${r.description}\n` +
    `metadata:\n${meta.join("\n")}\n` +
    `---\n\n` +
    `${r.body.trimEnd()}\n`
  );
}

// The generated MEMORY.md index — one line per record, same convention Claude uses.
export function renderMemoryIndex(records: MemoryRecord[]): string {
  const lines = records.map(
    (r) => `- [${r.name}](${r.name}.md) — ${r.description}`,
  );
  return `# Memory index\n\n${lines.join("\n")}\n`;
}

// Write canonical out as Claude's memory dir (inject direction). Overwrites the
// records we manage and rebuilds MEMORY.md; leaves unrelated files untouched except
// records whose names disappeared from canonical (pruned to stay in sync).
export async function writeClaudeMemory(
  cwd: string,
  mem: CanonicalMemory,
): Promise<void> {
  const dir = claudeMemoryDir(cwd);
  await ensureDir(dir);
  const keep = new Set(mem.records.map((r) => `${r.name}.md`));
  keep.add("MEMORY.md");
  // prune records that canonical no longer has (a delete on another runtime/device)
  let existing: string[] = [];
  try {
    existing = await readdir(dir);
  } catch {
    /* fresh dir */
  }
  for (const f of existing) {
    if (f.endsWith(".md") && !keep.has(f)) await rm(join(dir, f));
  }
  for (const r of mem.records) {
    await writeFile(join(dir, `${r.name}.md`), renderClaudeRecord(r));
  }
  await writeFile(join(dir, "MEMORY.md"), renderMemoryIndex(mem.records));
}
