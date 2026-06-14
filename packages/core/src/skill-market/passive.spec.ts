import { describe, it, expect } from "vitest";
import { passiveWorkflowProse, renderSkillsBlock } from "./passive.js";
import { spliceCodexBlock, renderCodexBlock, spliceMarkedBlock } from "../memory/convert/codex.js";

describe("passive skill-shopping prose (issue #21)", () => {
  it("ON prose drives the shop workflow (verify before buy)", () => {
    const p = passiveWorkflowProse({ on: true });
    expect(p).toContain("search_skills");
    expect(p).toContain("verify_skill");
    expect(p).toContain("buy_skill");
  });

  it("OFF funded prose allows a funds-gated suggestion via read-only tools", () => {
    const p = passiveWorkflowProse({ on: false, offCanSuggest: true });
    expect(p).toContain("buy it?");
    expect(p).toContain("search_skills");
    expect(p).toContain("wallet_balance");
    expect(p).toContain("NO buy or"); // no buy/verify tools in OFF
  });

  it("OFF empty-wallet prose stays fully silent (no suggestion)", () => {
    const p = passiveWorkflowProse({ on: false, offCanSuggest: false });
    expect(p).not.toContain("buy it?");
    expect(p).toContain("fully silent");
  });
});

describe("codex skills block splicing", () => {
  const SKILLS_START = "<!-- agentnet:skills:start -->";
  const SKILLS_END = "<!-- agentnet:skills:end -->";

  it("re-splicing the skills block is idempotent", () => {
    const block = renderSkillsBlock({ on: true });
    const once = spliceMarkedBlock("# human notes\n", block, SKILLS_START, SKILLS_END);
    const twice = spliceMarkedBlock(once, block, SKILLS_START, SKILLS_END);
    expect(twice).toBe(once);
    expect(once).toContain("# human notes");
  });

  it("skills block coexists with the memory block (distinct markers)", () => {
    const mem = renderCodexBlock({ records: [{ name: "n", description: "d", body: "b" }] } as any);
    const skills = renderSkillsBlock({ on: true });
    let doc = spliceCodexBlock("", mem);
    doc = spliceMarkedBlock(doc, skills, SKILLS_START, SKILLS_END);

    expect(doc).toContain("agentnet:memory:start");
    expect(doc).toContain("agentnet:skills:start");

    // re-splicing skills must not disturb the memory block
    const before = doc;
    doc = spliceMarkedBlock(doc, skills, SKILLS_START, SKILLS_END);
    expect(doc).toBe(before);
    expect(doc).toContain("agentnet:memory:start");
  });
});
