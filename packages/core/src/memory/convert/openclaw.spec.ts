import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderOpenclawBlock, writeOpenclawMemory } from "./openclaw.js";
import type { CanonicalMemory } from "../types.js";

const MEM: CanonicalMemory = {
  version: 1,
  records: [
    { name: "fact-one", description: "first fact", body: "Body one.", type: "project", updatedAt: 1 },
    { name: "fact-two", description: "second fact", body: "Body two.", type: "user", updatedAt: 2 },
  ],
};

describe("memory/convert/openclaw", () => {
  let ws: string;

  beforeEach(() => { ws = mkdtempSync(join(tmpdir(), "agentnet-ocmem-")); });
  afterEach(() => { rmSync(ws, { recursive: true, force: true }); });

  it("renders records as sections inside the fenced block", () => {
    const block = renderOpenclawBlock(MEM);
    expect(block).toContain("<!-- agentnet:memory:start -->");
    expect(block).toContain("## fact-one");
    expect(block).toContain("Body two.");
    expect(block.trimEnd().endsWith("<!-- agentnet:memory:end -->")).toBe(true);
  });

  it("preserves human content outside the markers and replaces the block on re-inject", async () => {
    const file = join(ws, "MEMORY.md");
    await writeFile(file, "# My own long-term notes\nkeep me\n");
    await writeOpenclawMemory(ws, MEM);
    const first = await readFile(file, "utf8");
    expect(first).toContain("keep me");
    expect(first).toContain("## fact-one");

    const updated: CanonicalMemory = { version: 1, records: [MEM.records[1]] };
    await writeOpenclawMemory(ws, updated);
    const second = await readFile(file, "utf8");
    expect(second).toContain("keep me");
    expect(second).not.toContain("fact-one");
    expect(second.match(/agentnet:memory:start/g)).toHaveLength(1);
  });

  it("does not create MEMORY.md for an empty canonical", async () => {
    await writeOpenclawMemory(ws, { version: 1, records: [] });
    await expect(readFile(join(ws, "MEMORY.md"), "utf8")).rejects.toThrow();
  });
});
