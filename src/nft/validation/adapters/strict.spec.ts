import { describe, it, expect } from "vitest";
import { StrictAdapter } from "./strict.js";

const adapter = new StrictAdapter();

// A fully valid strict skill
const VALID = `---
name: my-skill
description: A useful skill that teaches agents to reason step by step clearly
category: ai
license: MIT
repository: https://github.com/example/my-skill
---

This skill teaches agents to break down complex problems into smaller steps.
It covers planning, iteration, and verification of each reasoning step.
`;

describe("adapters/strict — StrictAdapter", () => {
  it("should pass a fully valid skill", async () => {
    const r = await adapter.validate(VALID);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("should error on non-kebab-case name", async () => {
    const md = VALID.replace("name: my-skill", "name: My Skill");
    const r = await adapter.validate(md);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.field === "name")).toBe(true);
  });

  it("should error on name longer than 64 chars", async () => {
    const longName = "a".repeat(65);
    const md = VALID.replace("name: my-skill", `name: ${longName}`);
    const r = await adapter.validate(md);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.field === "name")).toBe(true);
  });

  it("should error on description shorter than 20 chars", async () => {
    const md = VALID.replace(
      /description: .+/,
      "description: Too short"
    );
    const r = await adapter.validate(md);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.field === "description")).toBe(true);
  });

  it("should warn on description longer than 500 chars", async () => {
    const longDesc = "A ".repeat(260); // 520 chars
    const md = VALID.replace(/description: .+/, `description: ${longDesc}`);
    const r = await adapter.validate(md);
    expect(r.warnings.some((w) => w.field === "description")).toBe(true);
  });

  it("should give info when body is shorter than 50 chars", async () => {
    const md = `---
name: my-skill
description: A useful skill that teaches agents to reason step by step
---
Short.`;
    const r = await adapter.validate(md);
    expect(r.infos.some((i) => i.field === "body")).toBe(true);
  });

  it("should warn on invalid SPDX license", async () => {
    const md = VALID.replace("license: MIT", "license: Not A License");
    const r = await adapter.validate(md);
    expect(r.warnings.some((w) => w.field === "license")).toBe(true);
  });

  it("should warn on invalid repository URL", async () => {
    const md = VALID.replace(
      "repository: https://github.com/example/my-skill",
      "repository: not-a-url"
    );
    const r = await adapter.validate(md);
    expect(r.warnings.some((w) => w.field === "repository")).toBe(true);
  });
});
