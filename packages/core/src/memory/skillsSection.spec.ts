import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the filesystem + paths so the test is pure (no real skills dir, no real
// memory files). We assert the splice behaviour: the managed block is created,
// replaced in place, and never disturbs content outside the markers.
const files = new Map<string, string>();
let skillDirs: string[] = [];
let codexSkillDirs: string[] = [];

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(async (dir: string) => (dir === "/codex-skills" ? codexSkillDirs : skillDirs).map((name) => ({ name, isDirectory: () => true }))),
  readFile: vi.fn(async (f: string) => {
    if (files.has(f)) return files.get(f)!;
    throw new Error("ENOENT");
  }),
  writeFile: vi.fn(async (f: string, data: string) => { files.set(f, data); }),
}));

vi.mock("../core/paths.js", () => ({
  claudeSkillsDir: () => "/skills",
  codexSkillsDir: () => "/codex-skills",
  claudeMemoryDir: () => "/mem",
  codexAgentsFile: (cwd: string) => `${cwd}/AGENTS.md`,
}));

import { updateSkillsSection } from "./skillsSection.js";

const MEMORY = "/mem/MEMORY.md";

describe("memory/skillsSection", () => {
  beforeEach(() => { files.clear(); skillDirs = []; codexSkillDirs = []; });

  it("writes a one-line block naming installed skills (claude MEMORY.md)", async () => {
    skillDirs = ["code-review", "changelog-generator"];
    await updateSkillsSection("claude", "/proj");
    const out = files.get(MEMORY)!;
    expect(out).toContain("<!-- agentnet:skills:start -->");
    expect(out).toContain("<!-- agentnet:skills:end -->");
    expect(out).toContain("changelog-generator, code-review"); // sorted, comma-joined
    expect(out).toContain("~/.claude/skills/");
  });

  it("says none when no skills are installed", async () => {
    skillDirs = [];
    await updateSkillsSection("claude", "/proj");
    expect(files.get(MEMORY)!).toContain("No skills are installed yet.");
  });

  it("replaces the block in place and preserves content outside the markers", async () => {
    files.set(MEMORY, "# Memory index\n\n- a note\n\n<!-- agentnet:skills:start -->\nold line\n<!-- agentnet:skills:end -->");
    skillDirs = ["new-skill"];
    await updateSkillsSection("claude", "/proj");
    const out = files.get(MEMORY)!;
    expect(out).toContain("# Memory index");
    expect(out).toContain("- a note");      // human content untouched
    expect(out).toContain("new-skill");      // block refreshed
    expect(out).not.toContain("old line");   // old block gone
    expect(out.match(/agentnet:skills:start/g)?.length).toBe(1); // exactly one block
  });

  it("targets AGENTS.md for codex", async () => {
    skillDirs = ["claude-only"];
    codexSkillDirs = ["codex-only"];
    await updateSkillsSection("codex", "/proj");
    const out = files.get("/proj/AGENTS.md")!;
    expect(out).toContain("codex-only");
    expect(out).toContain("~/.codex/skills/");
    expect(out).not.toContain("claude-only");
    expect(files.has(MEMORY)).toBe(false);
  });
});
