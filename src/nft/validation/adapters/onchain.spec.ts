import { describe, it, expect } from "vitest";
import { OnchainAdapter, INLINE_MAX_BYTES } from "./onchain.js";

const adapter = new OnchainAdapter();

// A valid, concise on-chain skill (well under 700B)
const VALID = `---
name: my-skill
description: A useful skill that teaches agents to reason step by step clearly
category: ai
hashtags: [reasoning, planning]
---

This skill teaches step-by-step reasoning for AI agents.
`;

describe("adapters/onchain — OnchainAdapter", () => {
  it("should pass a valid skill under 700B with category", async () => {
    const r = await adapter.validate(VALID);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it(`should error when skill exceeds ${INLINE_MAX_BYTES}B`, async () => {
    // Generate a skill that's definitely over 700 bytes
    const longBody = "x".repeat(800);
    const md = `---
name: my-skill
description: A useful skill that teaches agents to reason step by step
category: ai
---
${longBody}`;
    const r = await adapter.validate(md);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.field === "size")).toBe(true);
  });

  it("should warn when category is missing", async () => {
    const md = VALID.replace("category: ai\n", "");
    const r = await adapter.validate(md);
    expect(r.warnings.some((w) => w.field === "category")).toBe(true);
  });

  it("should warn on hashtags with uppercase or spaces", async () => {
    const md = VALID.replace(
      "hashtags: [reasoning, planning]",
      "hashtags: [Reasoning, has space]"
    );
    const r = await adapter.validate(md);
    expect(r.warnings.some((w) => w.field === "hashtags")).toBe(true);
  });

  it("should accept lowercase alphanumeric hashtags", async () => {
    const md = VALID.replace(
      "hashtags: [reasoning, planning]",
      "hashtags: [reasoning, step-by-step]"
    );
    const r = await adapter.validate(md);
    // No hashtag warnings
    expect(r.warnings.filter((w) => w.field === "hashtags")).toHaveLength(0);
  });

  it("should report byte count accurately in error message", async () => {
    const longBody = "x".repeat(800);
    const md = `---
name: my-skill
description: A useful skill that teaches step-by-step reasoning
category: ai
---
${longBody}`;
    const r = await adapter.validate(md);
    const sizeError = r.errors.find((e) => e.field === "size");
    expect(sizeError?.message).toContain("700B");
  });
});
