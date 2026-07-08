import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("soul/convert/native — global instruction file block", () => {
  let home: string;
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    home = mkdtempSync(join(tmpdir(), "agentnet-native-"));
    process.env.AGENTNET_HOME = join(home, "agentnet");
    process.env.CLAUDE_CONFIG_DIR = join(home, "claude");
    process.env.CODEX_HOME = join(home, "codex");
  });

  afterEach(() => {
    process.env = { ...origEnv };
    rmSync(home, { recursive: true, force: true });
  });

  it("splices the soul block into CLAUDE.md, preserving human content, idempotently", async () => {
    const { writeSoulBlock, soulFile } = await import("./native.js");
    mkdirSync(join(home, "claude"), { recursive: true });
    const file = soulFile("claude");
    await writeFile(file, "# my own global rules\nkeep these\n");
    await writeSoulBlock(file, "# Luna\n\n## Style\n- terse");
    await writeSoulBlock(file, "# Luna v2");
    const out = await readFile(file, "utf8");
    expect(out).toContain("keep these");
    expect(out).toContain("# Luna v2");
    expect(out).not.toContain("## Style");
    expect(out.match(/agentnet:soul:start/g)).toHaveLength(1);
  });

  it("injectSoulNative is a no-op when the engine home is missing", async () => {
    const { injectSoulNative } = await import("./native.js");
    const fakeStore = { load: async () => ({ version: 1 as const, text: "x", lastWriter: { device: "d", label: "l", ts: 1 } }) };
    expect(await injectSoulNative("codex", fakeStore as any)).toBe(false);
  });

  it("injectSoulNative writes the block when home exists and a soul is stored", async () => {
    const { injectSoulNative, soulFile } = await import("./native.js");
    mkdirSync(join(home, "codex"), { recursive: true });
    const fakeStore = { load: async () => ({ version: 1 as const, text: "# Persona", lastWriter: { device: "d", label: "l", ts: 1 } }) };
    expect(await injectSoulNative("codex", fakeStore as any)).toBe(true);
    expect(await readFile(soulFile("codex"), "utf8")).toContain("# Persona");
  });
});
