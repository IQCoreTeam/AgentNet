import { describe, it, expect } from "vitest";
import { OnchainAdapter } from "./onchain.js";

const adapter = new OnchainAdapter();

// A valid, concise on-chain skill.
const VALID = `---
name: my-skill
description: A useful skill that teaches agents to reason step by step clearly
category: ai
hashtags: [reasoning, planning]
---

This skill teaches step-by-step reasoning for AI agents.
`;

describe("adapters/onchain — OnchainAdapter", () => {
  it("should pass a valid skill with category", async () => {
    const r = await adapter.checkFormat(VALID);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("does NOT error on a long skill — codeIn auto-chunks past 700B", async () => {
    const longBody = "x".repeat(2000);
    const md = `---
name: my-skill
description: A useful skill that teaches agents to reason step by step
category: ai
---
${longBody}`;
    const r = await adapter.checkFormat(md);
    expect(r.errors.some((e) => e.field === "size")).toBe(false);
    expect(r.ok).toBe(true);
  });

  it("should warn when category is missing", async () => {
    const md = VALID.replace("category: ai\n", "");
    const r = await adapter.checkFormat(md);
    expect(r.warnings.some((w) => w.field === "category")).toBe(true);
  });

  it("should warn on hashtags with uppercase or spaces", async () => {
    const md = VALID.replace(
      "hashtags: [reasoning, planning]",
      "hashtags: [Reasoning, has space]"
    );
    const r = await adapter.checkFormat(md);
    expect(r.warnings.some((w) => w.field === "hashtags")).toBe(true);
  });

  it("should accept lowercase alphanumeric hashtags", async () => {
    const md = VALID.replace(
      "hashtags: [reasoning, planning]",
      "hashtags: [reasoning, step-by-step]"
    );
    const r = await adapter.checkFormat(md);
    // No hashtag warnings
    expect(r.warnings.filter((w) => w.field === "hashtags")).toHaveLength(0);
  });
});
