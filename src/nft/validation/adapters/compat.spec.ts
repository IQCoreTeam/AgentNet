import { describe, it, expect } from "vitest";
import { SkillsShCompatAdapter } from "./compat.js";

const adapter = new SkillsShCompatAdapter();

const VALID = `---
name: my-skill
description: A useful skill
---
Body text here.`;

describe("adapters/compat — SkillsShCompatAdapter", () => {
  it("should pass a skill with name and description", async () => {
    const r = await adapter.validate(VALID);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("should error when name is missing", async () => {
    const md = `---\ndescription: A description\n---\nBody.`;
    const r = await adapter.validate(md);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.field === "name")).toBe(true);
  });

  it("should error when description is missing", async () => {
    const md = `---\nname: my-skill\n---\nBody.`;
    const r = await adapter.validate(md);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.field === "description")).toBe(true);
  });

  it("should error when both name and description are missing", async () => {
    const md = `---\nauthor: someone\n---\nBody.`;
    const r = await adapter.validate(md);
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(2);
  });

  it("should error when name is whitespace only", async () => {
    const md = `---\nname: "   "\ndescription: A description\n---\nBody.`;
    const r = await adapter.validate(md);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.field === "name")).toBe(true);
  });
});
