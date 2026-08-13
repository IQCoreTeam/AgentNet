import { describe, it, expect, vi, beforeEach } from "vitest";
import { marketplaceEnv } from "./env.js";
import { publishSkill as corePublishSkill } from "../../nft/skill.js";
import { publishWorkflow as corePublishWorkflow } from "../../nft/workflow.js";
import { postAgentNote as corePostAgentNote } from "../../notes/notes.js";
import { getNetwork } from "../../core/seed.js";
import { saveGithubToken, loadGithubToken, maskedGithubToken } from "../../core/rpc.js";
import { registerVerifiedWork } from "../../core/verifiedWork.js";

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
  saveGithubToken: vi.fn(),
  loadGithubToken: vi.fn().mockResolvedValue(null),
  maskedGithubToken: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../core/verifiedWork.js", () => ({
  registerVerifiedWork: vi.fn(),
}));

// Partial mock: getNetwork becomes controllable (the airdrop guard needs a non-devnet
// answer) while keeping its real devnet default and the rest of the seed module real.
vi.mock("../../core/seed.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../core/seed.js")>();
  return { ...actual, getNetwork: vi.fn(() => "devnet" as const) };
});

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

describe("skill-market/ingest/env github", () => {
  const mockWallet = { address: "mockWalletAddress" } as any;

  it("reports no token as hasToken false", async () => {
    vi.mocked(maskedGithubToken).mockResolvedValue(null);

    const env = await marketplaceEnv(mockWallet);
    expect(await env.getGithubStatus()).toEqual({ hasToken: false, masked: undefined });
  });

  it("stores the token and answers with the refreshed mask", async () => {
    vi.mocked(maskedGithubToken).mockResolvedValue("••••AB12");

    const env = await marketplaceEnv(mockWallet);
    const res = await env.submitGithubToken("ghp_secret");

    expect(saveGithubToken).toHaveBeenCalledWith("ghp_secret");
    expect(res).toEqual({ hasToken: true, masked: "••••AB12" });
  });

  // The dispatcher spreads this result straight into a githubStatus reply with no
  // catch of its own — a rejection here would be an unhandled rejection in the host
  // and a modal that hangs on "Saving…" forever.
  it("answers a failed token save as an error instead of rejecting", async () => {
    vi.mocked(saveGithubToken).mockRejectedValueOnce(new Error("EACCES: permission denied"));

    const env = await marketplaceEnv(mockWallet);
    const res = await env.submitGithubToken("ghp_secret");

    expect(res).toEqual({ hasToken: false, masked: undefined, error: "EACCES: permission denied" });
  });

  // Both surface copies of this flow refuse without a connected wallet;
  // registerVerifiedWork needs no signature, so the env member must refuse too or a
  // wallet-less env would commit its placeholder address as the public marker.
  it("refuses to register work without a connected wallet", async () => {
    vi.mocked(loadGithubToken).mockResolvedValue({ token: "ghp_secret" });

    const env = await marketplaceEnv({ address: "" } as any);
    const res = await env.registerWorkRepo("owner/repo", ["mint1"]);

    expect(res).toEqual({ ok: false, error: "Connect a wallet first." });
    expect(registerVerifiedWork).not.toHaveBeenCalled();
  });

  it("refuses to register work without a stored token", async () => {
    vi.mocked(loadGithubToken).mockResolvedValue(null);

    const env = await marketplaceEnv(mockWallet);
    const res = await env.registerWorkRepo("owner/repo", ["mint1"]);

    expect(res).toEqual({ ok: false, error: "Add a GitHub token first." });
    expect(registerVerifiedWork).not.toHaveBeenCalled();
  });

  it("registers the repo with the connected wallet's address", async () => {
    vi.mocked(loadGithubToken).mockResolvedValue({ token: "ghp_secret" });
    vi.mocked(registerVerifiedWork).mockResolvedValue({ count: 2, repo: "owner/repo", markerAdded: true });

    const env = await marketplaceEnv(mockWallet);
    const res = await env.registerWorkRepo("owner/repo", ["mint1", "mint2"]);

    expect(registerVerifiedWork).toHaveBeenCalledWith({
      token: "ghp_secret",
      repo: "owner/repo",
      skillMints: ["mint1", "mint2"],
      walletAddress: "mockWalletAddress",
    });
    expect(res).toEqual({ ok: true, count: 2, repo: "owner/repo" });
  });

  it("surfaces a registration failure as its message", async () => {
    vi.mocked(loadGithubToken).mockResolvedValue({ token: "ghp_secret" });
    vi.mocked(registerVerifiedWork).mockRejectedValue(new Error("Enter a repo as owner/name or a github.com URL."));

    const env = await marketplaceEnv(mockWallet);
    const res = await env.registerWorkRepo("not a repo", ["mint1"]);

    expect(res).toEqual({ ok: false, error: "Enter a repo as owner/name or a github.com URL." });
  });
});

describe("skill-market/ingest/env airdrop", () => {
  const mockWallet = { address: "mockWalletAddress" } as any;

  // Mainnet has no faucet, so the guard must answer with an actionable error
  // before any RPC is attempted (plan tab 26: wire airdrop, devnet only).
  it("refuses off devnet without touching the connection", async () => {
    vi.mocked(getNetwork).mockReturnValueOnce("mainnet");

    const env = await marketplaceEnv(mockWallet);
    const res = await env.airdrop();

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/devnet only/);
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
