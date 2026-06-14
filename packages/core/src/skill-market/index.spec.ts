import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAgentNetTools, handleToolCall, newVerifyGate } from "./index.js";
import { searchSkills } from "../search/search.js";
import { buySkill } from "../nft/skill.js";
import { readSkillText } from "../nft/token2022.js";
import { signerAddress } from "../core/chain.js";
import { Keypair } from "@solana/web3.js";

vi.mock("../search/search.js", () => ({
  searchSkills: vi.fn(),
}));

vi.mock("../nft/skill.js", () => ({
  buySkill: vi.fn(),
}));

vi.mock("../nft/token2022.js", () => ({
  readSkillText: vi.fn(),
}));

vi.mock("../core/chain.js", () => ({
  signerAddress: vi.fn().mockResolvedValue("mockSignerAddress"),
}));

describe("skill-market", () => {
  let mockConn: any;
  let signer: Keypair;

  beforeEach(() => {
    mockConn = {};
    signer = Keypair.generate();
    vi.clearAllMocks();
  });

  it("should list available tools", () => {
    const tools = getAgentNetTools();
    expect(tools).toHaveLength(4);
    expect(tools.map(t => t.name)).toEqual(["search_skills", "wallet_balance", "verify_skill", "buy_skill"]);
  });

  it("should handle search_skills tool call and return empty if no results", async () => {
    vi.mocked(searchSkills).mockResolvedValue([]);
    const result = await handleToolCall(mockConn, signer, "defaultCreator", "search_skills", {});
    expect(result.content[0].text).toContain("No matching skills found");
    expect(searchSkills).toHaveBeenCalledWith(mockConn, { filters: { keyword: undefined, category: undefined, type: undefined } });
  });

  it("should handle search_skills with results", async () => {
    vi.mocked(searchSkills).mockResolvedValue([
      { id: "skill1", name: "React", description: "desc", creator: "creator", category: "frontend", type: "skill", supply: 10, uriTxid: "tx1", createdAt: 100 }
    ]);
    const result = await handleToolCall(mockConn, signer, "defaultCreator", "search_skills", { keyword: "React", type: "skill" });
    expect(result.content[0].text).toContain("Found 1 results");
    expect(result.content[0].text).toContain("skill1");
    expect(searchSkills).toHaveBeenCalledWith(mockConn, { filters: { keyword: "React", category: undefined, type: "skill" } });
  });

  it("should handle buy_skill tool call", async () => {
    vi.mocked(buySkill).mockResolvedValue("mockTxSig");
    const result = await handleToolCall(mockConn, signer, "defaultCreator", "buy_skill", { skillId: "skill1" });
    expect(result.content[0].text).toContain("Successfully purchased");
    expect(result.content[0].text).toContain("mockTxSig");
    // Price is read from the item's on-chain config now — the client doesn't pass it.
    expect(buySkill).toHaveBeenCalledWith(mockConn, signer, {
      skillId: "skill1",
      buyerWallet: "mockSignerAddress",
      creatorWallet: "defaultCreator",
    });
  });

  it("should handle buy_skill errors", async () => {
    vi.mocked(buySkill).mockRejectedValue(new Error("Insufficient funds"));
    const result = await handleToolCall(mockConn, signer, "defaultCreator", "buy_skill", { skillId: "skill1" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Insufficient funds");
  });

  it("should throw on unknown tool", async () => {
    await expect(handleToolCall(mockConn, signer, "defaultCreator", "unknown_tool", {})).rejects.toThrow("Unknown tool");
  });

  // ── hard verify gate (issue #21) ──
  it("rejects buy_skill when not verified this session", async () => {
    const gate = newVerifyGate();
    const result = await handleToolCall(mockConn, signer, "defaultCreator", "buy_skill", { skillId: "skill1" }, gate);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("verify_skill is required");
    expect(buySkill).not.toHaveBeenCalled();
  });

  it("allows buy_skill after a verify_skill pass for the same skill", async () => {
    vi.mocked(readSkillText).mockResolvedValue("# skill body");
    vi.mocked(buySkill).mockResolvedValue("mockTxSig");
    const gate = newVerifyGate();

    const verified = await handleToolCall(mockConn, signer, "defaultCreator", "verify_skill", { skillId: "skill1" }, gate);
    expect(verified.isError).toBeUndefined();
    expect(readSkillText).toHaveBeenCalledWith(mockConn, "skill1");
    expect(gate.isVerified("skill1")).toBe(true);

    const bought = await handleToolCall(mockConn, signer, "defaultCreator", "buy_skill", { skillId: "skill1" }, gate);
    expect(bought.content[0].text).toContain("Successfully purchased");
    expect(buySkill).toHaveBeenCalledTimes(1);
  });

  it("verify_skill does not record a pass when no on-chain text exists", async () => {
    vi.mocked(readSkillText).mockResolvedValue(null);
    const gate = newVerifyGate();
    const result = await handleToolCall(mockConn, signer, "defaultCreator", "verify_skill", { skillId: "skill1" }, gate);
    expect(result.isError).toBe(true);
    expect(gate.isVerified("skill1")).toBe(false);
  });

  // ── wallet_balance (OFF-mode funds gate read, issue #21) ──
  it("wallet_balance returns the wallet's native SOL balance", async () => {
    vi.mocked(signerAddress).mockResolvedValue(signer.publicKey.toBase58()); // valid base58 for new PublicKey
    mockConn.getBalance = vi.fn().mockResolvedValue(2_000_000);
    const result = await handleToolCall(mockConn, signer, "defaultCreator", "wallet_balance", {});
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("2000000 lamports");
  });
});
