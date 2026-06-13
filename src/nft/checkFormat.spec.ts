import { describe, it, expect } from "vitest";
import { checkFormat, checkWorkflowFormat, FormatError } from "./checkFormat.js";

const VALID = `---
name: my-skill
description: A useful skill that teaches agents to reason step by step clearly
category: ai
hashtags: [reasoning, planning]
---

This skill teaches step-by-step reasoning for AI agents over many lines of text.
`;

describe("nft/checkFormat — checkFormat", () => {
  it("passes a valid skill", () => {
    const r = checkFormat(VALID);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("errors when name/description are missing (no frontmatter)", () => {
    const r = checkFormat("just text, no frontmatter");
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.field === "name")).toBe(true);
    expect(r.errors.some((e) => e.field === "description")).toBe(true);
  });

  it("errors on a non-kebab-case name", () => {
    const r = checkFormat(VALID.replace("name: my-skill", "name: MySkill"));
    expect(r.errors.some((e) => e.field === "name")).toBe(true);
  });

  it("errors on a too-short description", () => {
    const r = checkFormat(VALID.replace(/description: .*/, "description: short"));
    expect(r.errors.some((e) => e.field === "description")).toBe(true);
  });

  it("does NOT error on a long skill (codeIn auto-chunks; no size rule)", () => {
    const r = checkFormat(VALID + "x".repeat(5000));
    expect(r.errors.some((e) => e.field === "size")).toBe(false);
    expect(r.ok).toBe(true);
  });

  it("warns when category is missing", () => {
    const r = checkFormat(VALID.replace("category: ai\n", ""));
    expect(r.warnings.some((w) => w.field === "category")).toBe(true);
  });

  it("warns on bad hashtags (uppercase / spaces)", () => {
    const r = checkFormat(VALID.replace("hashtags: [reasoning, planning]", "hashtags: [Reasoning, has space]"));
    expect(r.warnings.some((w) => w.field === "hashtags")).toBe(true);
  });
});

describe("nft/checkFormat — checkWorkflowFormat", () => {
  const VALID_WF = `---
name: my-workflow
description: A workflow that chains a few skills into one repeatable job flow
category: ai
type: workflow
requiredSkills: [So11111111111111111111111111111111111111112]
---

Run skill A, then B, then C to complete the job end to end here.
`;

  it("passes a valid workflow", () => {
    const r = checkWorkflowFormat(VALID_WF);
    expect(r.ok).toBe(true);
  });

  it("errors when type is not workflow", () => {
    const r = checkWorkflowFormat(VALID_WF.replace("type: workflow", "type: skill"));
    expect(r.errors.some((e) => e.field === "type")).toBe(true);
  });

  it("errors when requiredSkills is empty", () => {
    const r = checkWorkflowFormat(VALID_WF.replace(/requiredSkills: .*/, "requiredSkills: []"));
    expect(r.errors.some((e) => e.field === "requiredSkills")).toBe(true);
  });

  it("errors on invalid base58 in requiredSkills", () => {
    const r = checkWorkflowFormat(VALID_WF.replace(/requiredSkills: .*/, "requiredSkills: [not-a-mint]"));
    expect(r.errors.some((e) => e.field === "requiredSkills")).toBe(true);
  });
});

describe("nft/checkFormat — FormatError", () => {
  it("carries the issues and a readable message", () => {
    const err = new FormatError([{ field: "name", severity: "error", message: "missing" }]);
    expect(err.issues).toHaveLength(1);
    expect(err.message).toContain("[name]");
  });
});
