import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the filesystem + paths so the test is pure (no real memory files). We assert the
// managed block is spliced in when the surface opts in, self-removes when it does not, never
// dirties a file to write nothing, and leaves content outside the markers untouched — all via
// the SAME shared spliceIntoFile the skills section uses (proving one splicer, not two).
const files = new Map<string, string>();
const writeSpy = vi.fn(async (f: string, data: string) => { files.set(f, data); });

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async (f: string) => {
    if (files.has(f)) return files.get(f)!;
    throw new Error("ENOENT");
  }),
  writeFile: (f: string, data: string) => writeSpy(f, data),
  // present only so skillsSection.js (imported transitively) type-loads; unused here.
  readdir: vi.fn(async () => []),
}));

vi.mock("../core/paths.js", () => ({
  claudeSkillsDir: () => "/skills",
  claudeMemoryDir: () => "/mem",
  codexAgentsFile: (cwd: string) => `${cwd}/AGENTS.md`,
}));

import { updatePreviewSection } from "./previewSection.js";

const MEMORY = "/mem/MEMORY.md";
const START = "<!-- agentnet:preview:start -->";
const END = "<!-- agentnet:preview:end -->";
const prevEnv = process.env.AGENTNET_PREVIEW_HINT;

describe("memory/previewSection", () => {
  beforeEach(() => { files.clear(); writeSpy.mockClear(); delete process.env.AGENTNET_PREVIEW_HINT; });
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.AGENTNET_PREVIEW_HINT;
    else process.env.AGENTNET_PREVIEW_HINT = prevEnv;
  });

  it("renders the loopback-link hint when the surface opts in (AGENTNET_PREVIEW_HINT set)", async () => {
    process.env.AGENTNET_PREVIEW_HINT = "1";
    await updatePreviewSection("claude", "/proj");
    const out = files.get(MEMORY)!;
    expect(out).toContain(START);
    expect(out).toContain(END);
    expect(out).toContain("http://localhost:PORT");
    expect(out).toContain("BACKGROUND");
    expect(out).not.toMatch(/[—–]/); // no em-dash or en-dash in an agent-facing string
    expect(out).not.toContain("/preview/announce"); // no endpoint to POST — the plugin owns no server
  });

  it("removes the block when the surface does not opt in, keeping content outside the markers", async () => {
    files.set(MEMORY, `# Memory index\n\n- a note\n\n${START}\nold hint\n${END}`);
    await updatePreviewSection("claude", "/proj"); // env unset
    const out = files.get(MEMORY)!;
    expect(out).toContain("# Memory index");
    expect(out).toContain("- a note");     // human content untouched
    expect(out).not.toContain(START);      // block gone
    expect(out).not.toContain("old hint");
  });

  it("never dirties a file to write nothing (disabled + no existing block = no write)", async () => {
    await updatePreviewSection("claude", "/proj"); // env unset, no file/markers
    expect(writeSpy).not.toHaveBeenCalled();
    expect(files.has(MEMORY)).toBe(false);
  });

  it("toggles idempotently through the SHARED splicer: add, then remove, exactly one block each pass", async () => {
    process.env.AGENTNET_PREVIEW_HINT = "1";
    await updatePreviewSection("claude", "/proj");
    let out = files.get(MEMORY)!;
    expect(out.match(/agentnet:preview:start/g)?.length).toBe(1);
    // re-run enabled: still exactly one block (replace-in-place, not appended)
    await updatePreviewSection("claude", "/proj");
    out = files.get(MEMORY)!;
    expect(out.match(/agentnet:preview:start/g)?.length).toBe(1);
    // now disable: the block is spliced out
    delete process.env.AGENTNET_PREVIEW_HINT;
    await updatePreviewSection("claude", "/proj");
    expect(files.get(MEMORY)!).not.toContain(START);
  });

  it("targets AGENTS.md for codex via the shared memoryFileFor mapping", async () => {
    process.env.AGENTNET_PREVIEW_HINT = "1";
    await updatePreviewSection("codex", "/proj");
    expect(files.has("/proj/AGENTS.md")).toBe(true);
    expect(files.has(MEMORY)).toBe(false);
  });
});
