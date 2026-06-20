import { describe, it, expect, vi, beforeEach } from "vitest";
import { marketplaceEnv } from "./env.js";
import { publishSkill as corePublishSkill } from "../../nft/skill.js";
import { publishWorkflow as corePublishWorkflow } from "../../nft/workflow.js";

vi.mock("../../nft/skill.js", () => ({
  publishSkill: vi.fn().mockResolvedValue("mockSkillMint"),
  buySkill: vi.fn(),
}));

vi.mock("../../nft/workflow.js", () => ({
  publishWorkflow: vi.fn().mockResolvedValue("mockWorkflowMint"),
}));

vi.mock("../../core/chain.js", () => ({
  init: vi.fn(),
  signerAddress: vi.fn().mockResolvedValue("mockAddress"),
}));

vi.mock("../../core/rpc.js", () => ({
  resolveRpcUrl: vi.fn().mockResolvedValue("http://localhost:8899"),
}));

describe("skill-market/ingest/env publish", () => {
  const mockWallet = { address: "mockWalletAddress" } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes workflow frontmatter to publishWorkflow", async () => {
    const text = `---
type: workflow
requiredSkills: [skillMint1, skillMint2]
---
Some workflow body`;

    const env = await marketplaceEnv(mockWallet);
    const result = await env.publishSkill({
      name: "My Workflow",
      description: "A workflow",
      text,
      category: "testing",
      hashtags: ["test", "workflow"],
      priceSol: "0.25",
    });

    expect(result).toEqual({ ok: true, mint: "mockWorkflowMint" });
    expect(corePublishWorkflow).toHaveBeenCalledWith(expect.any(Object), mockWallet, {
      name: "My Workflow",
      description: "A workflow",
      text,
      requiredSkills: ["skillMint1", "skillMint2"],
      category: "testing",
      hashtags: ["test", "workflow"],
      price: 250000000n,
    });
    expect(corePublishSkill).not.toHaveBeenCalled();
  });

  it("routes skill frontmatter to publishSkill", async () => {
    const text = `---
type: skill
---
Some skill body`;

    const env = await marketplaceEnv(mockWallet);
    const result = await env.publishSkill({
      name: "My Skill",
      description: "A skill",
      text,
      category: "testing",
      hashtags: ["test"],
      priceSol: "0.1",
    });

    expect(result).toEqual({ ok: true, mint: "mockSkillMint" });
    expect(corePublishSkill).toHaveBeenCalledWith(expect.any(Object), mockWallet, {
      name: "My Skill",
      description: "A skill",
      text,
      category: "testing",
      hashtags: ["test"],
      price: 100000000n,
      image: undefined,
    });
    expect(corePublishWorkflow).not.toHaveBeenCalled();
  });

  it("routes missing frontmatter to publishSkill", async () => {
    const text = "Pure markdown without frontmatter";

    const env = await marketplaceEnv(mockWallet);
    const result = await env.publishSkill({
      name: "My Skill",
      description: "A skill",
      text,
      priceSol: "1",
    });

    expect(result).toEqual({ ok: true, mint: "mockSkillMint" });
    expect(corePublishSkill).toHaveBeenCalledWith(expect.any(Object), mockWallet, {
      name: "My Skill",
      description: "A skill",
      text,
      category: undefined,
      hashtags: undefined,
      price: 1000000000n,
      image: undefined,
    });
    expect(corePublishWorkflow).not.toHaveBeenCalled();
  });
});
