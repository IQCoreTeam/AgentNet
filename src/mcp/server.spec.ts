import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAgentNetTools, handleToolCall } from "./server.js";
import { searchSkills } from "../search/search.js";
import { buySkill } from "../nft/skill.js";
import { Keypair } from "@solana/web3.js";

vi.mock("../search/search.js", () => ({
  searchSkills: vi.fn(),
}));

vi.mock("../nft/skill.js", () => ({
  buySkill: vi.fn(),
}));

vi.mock("../core/chain.js", () => ({
  signerAddress: vi.fn().mockResolvedValue("mockSignerAddress"),
}));

describe("mcp/server", () => {
  let mockConn: any;
  let signer: Keypair;

  beforeEach(() => {
    mockConn = {};
    signer = Keypair.generate();
    vi.clearAllMocks();
  });

  it("should list available tools", () => {
    const tools = getAgentNetTools();
    expect(tools).toHaveLength(2);
    expect(tools.map(t => t.name)).toEqual(["search_skills", "buy_skill"]);
  });

  it("should handle search_skills tool call and return empty if no results", async () => {
    vi.mocked(searchSkills).mockResolvedValue([]);
    const result = await handleToolCall(mockConn, signer, "defaultCreator", "search_skills", {});
    expect(result.content[0].text).toContain("No matching skills found");
    expect(searchSkills).toHaveBeenCalledWith(mockConn, { filters: { keyword: undefined, category: undefined, type: undefined } });
  });

  it("should handle search_skills with results", async () => {
    vi.mocked(searchSkills).mockResolvedValue([
      { id: "skill1", name: "React", description: "desc", creator: "creator", category: "frontend", type: "skill", supply: 10, createdAt: 100 }
    ]);
    const result = await handleToolCall(mockConn, signer, "defaultCreator", "search_skills", { keyword: "React", type: "skill" });
    expect(result.content[0].text).toContain("Found 1 results");
    expect(result.content[0].text).toContain("skill1");
    expect(searchSkills).toHaveBeenCalledWith(mockConn, { filters: { keyword: "React", category: undefined, type: "skill" } });
  });

  it("should handle buy_skill tool call", async () => {
    vi.mocked(buySkill).mockResolvedValue("mockTxSig");
    const result = await handleToolCall(mockConn, signer, "defaultCreator", "buy_skill", { skillId: "skill1", price: 100 });
    expect(result.content[0].text).toContain("Successfully purchased");
    expect(result.content[0].text).toContain("mockTxSig");
    expect(buySkill).toHaveBeenCalledWith(mockConn, signer, {
      skillId: "skill1",
      buyerWallet: "mockSignerAddress",
      creatorWallet: "defaultCreator",
      price: 100n,
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
});
