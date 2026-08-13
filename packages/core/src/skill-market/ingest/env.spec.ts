import { describe, it, expect, vi, beforeEach } from "vitest";
import { marketplaceEnv } from "./env.js";
import { publishSkill as corePublishSkill } from "../../nft/skill.js";
import { publishWorkflow as corePublishWorkflow } from "../../nft/workflow.js";
import { postAgentNote as corePostAgentNote } from "../../notes/notes.js";

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

// The buy path goes through SkillSync.buyAndEquip (buy on-chain + equip locally);
// stub the class so a test can make the buy fail like a broke wallet does.
const { buyAndEquip } = vi.hoisted(() => ({ buyAndEquip: vi.fn() }));
vi.mock("./index.js", () => ({
  SkillSync: class {
    buyAndEquip = buyAndEquip;
  },
}));

vi.mock("../../core/rpc.js", () => ({
  resolveRpcUrl: vi.fn().mockResolvedValue("http://localhost:8899"),
}));

// Partial mock: only the agent-note write + re-read are stubbed; the rest of the
// notes module stays real so nothing else in env's import graph changes shape.
vi.mock("../../notes/notes.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../notes/notes.js")>();
  return {
    ...actual,
    postAgentNote: vi.fn().mockResolvedValue("note-id"),
    readAgentNotes: vi.fn().mockResolvedValue([]),
  };
});

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
    }, undefined);
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
    }, undefined);
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
    }, undefined);
    expect(corePublishWorkflow).not.toHaveBeenCalled();
  });
});

describe("skill-market/ingest/env buySkill", () => {
  const mockWallet = { address: "buyerWallet" } as any;

  // The machine-readable code is what lets a surface open a fund prompt instead of
  // only toasting the raw chain error (plan tab 26: FUNDING panel on insufficient_funds).
  it("tags a broke-wallet failure with code insufficient_funds", async () => {
    buyAndEquip.mockRejectedValueOnce(new Error("Attempt to debit an account but found no record of a prior credit. Logs: []"));

    const env = await marketplaceEnv(mockWallet);
    const res = await env.buySkill("mintX");

    expect(res.ok).toBe(false);
    expect(res.code).toBe("insufficient_funds");
    expect(res.error).toMatch(/Not enough SOL/);
  });

  it("passes other buy errors through verbatim, uncoded", async () => {
    buyAndEquip.mockRejectedValueOnce(new Error("custom program error: 0x1771"));

    const env = await marketplaceEnv(mockWallet);
    const res = await env.buySkill("mintX");

    expect(res).toEqual({ ok: false, error: "custom program error: 0x1771", code: undefined });
  });
});

describe("skill-market/ingest/env postAgentNote", () => {
  const mockWallet = { address: "mockWalletAddress" } as any;

  // parentId is what threads a reply under its parent note (GH #101); the CLI's
  // MarketApi passes it as the 6th arg, so it must reach the core write intact.
  it("forwards parentId to the core write", async () => {
    const env = await marketplaceEnv(mockWallet);
    const res = await env.postAgentNote("agentW", "nice work", undefined, undefined, undefined, "note-1");

    expect(res.ok).toBe(true);
    expect(corePostAgentNote).toHaveBeenCalledWith(
      expect.anything(),
      mockWallet,
      expect.objectContaining({ agentWallet: "agentW", text: "nice work", parentId: "note-1" }),
    );
  });

  it("leaves parentId undefined on a top-level post", async () => {
    const env = await marketplaceEnv(mockWallet);
    await env.postAgentNote("agentW", "hello");

    expect(corePostAgentNote).toHaveBeenCalledWith(
      expect.anything(),
      mockWallet,
      expect.objectContaining({ agentWallet: "agentW", text: "hello", parentId: undefined }),
    );
  });
});
