import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

// A cheap project file index for @-mention autocomplete. Walks the cwd once (skipping
// the usual noise), caps the count so a huge repo can't stall, and returns repo-relative
// paths. Substring-filtered in memory by the composer.
const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "out", ".cache", "coverage"]);

export async function indexFiles(root: string, cap = 4000): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string) {
    if (found.length >= cap) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (found.length >= cap) return;
      if (e.name.startsWith(".") && e.name !== ".env") continue;
      if (SKIP.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else found.push(relative(root, full));
    }
  }
  await walk(root);
  return found;
}

// rank matches: prefer basename prefix, then path substring.
export function filterFiles(files: string[], query: string, limit = 8): string[] {
  if (!query) return files.slice(0, limit);
  const q = query.toLowerCase();
  const scored = files
    .map((f) => {
      const base = f.split("/").pop()!.toLowerCase();
      let score = -1;
      if (base.startsWith(q)) score = 0;
      else if (base.includes(q)) score = 1;
      else if (f.toLowerCase().includes(q)) score = 2;
      return { f, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score || a.f.length - b.f.length);
  return scored.slice(0, limit).map((x) => x.f);
}
