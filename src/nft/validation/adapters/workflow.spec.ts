import { describe, it, expect } from "vitest";
import { WorkflowAdapter } from "./workflow.js";

const adapter = new WorkflowAdapter();

const VALID_WORKFLOW = `---
name: my-workflow
description: A useful workflow for agents
type: workflow
requiredSkills: [11111111111111111111111111111111, TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPvZeJ]
---
Workflow steps go here.
`;

describe("adapters/workflow — WorkflowAdapter", () => {
  it("should pass a valid workflow", async () => {
    const r = await adapter.checkFormat(VALID_WORKFLOW);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("should error if type is not workflow", async () => {
    const md = VALID_WORKFLOW.replace("type: workflow", "type: skill");
    const r = await adapter.checkFormat(md);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.field === "type")).toBe(true);
  });

  it("should error if requiredSkills is missing", async () => {
    const md = VALID_WORKFLOW.replace(/requiredSkills: .+\n/, "");
    const r = await adapter.checkFormat(md);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.field === "requiredSkills")).toBe(true);
  });

  it("should error if requiredSkills is empty", async () => {
    const md = VALID_WORKFLOW.replace(/requiredSkills: .+\n/, "requiredSkills: []\n");
    const r = await adapter.checkFormat(md);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.field === "requiredSkills")).toBe(true);
  });

  it("should error if requiredSkills contains invalid addresses", async () => {
    const md = VALID_WORKFLOW.replace(
      /requiredSkills: .+\n/,
      "requiredSkills: [11111111111111111111111111111111, invalid_address]\n"
    );
    const r = await adapter.checkFormat(md);
    expect(r.ok).toBe(false);
    const err = r.errors.find((e) => e.field === "requiredSkills");
    expect(err?.message).toContain("invalid_address");
  });
});
