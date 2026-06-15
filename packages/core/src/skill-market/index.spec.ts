import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAgentNetTools, handleToolCall } from "./index.js";
import { searchSkills } from "../search/search.js";
import { buySkill } from "../nft/skill.js";
import { postNote, postAgentNote } from "../notes/notes.js";
import { Keypair } from "@solana/web3.js";

vi.mock("../search/search.js", () => ({
  searchSkills: vi.fn(),
}));

vi.mock("../nft/skill.js", () => ({
  buySkill: vi.fn(),
}));

vi.mock("../notes/notes.js", () => ({
  postNote: vi.fn(),
  postAgentNote: vi.fn(),
}));

vi.mock("../core/chain.js", () => ({
  signerAddress: vi.fn().mockResolvedValue("mockSignerAddress"),
}));

vi.mock("../core/seed.js", () => ({
  getSkillsCollectionMint: vi.fn().mockReturnValue("skillsCollection111"),
  getWorkflowsCollectionMint: vi.fn().mockReturnValue("workflowsCollection111"),
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
    expect(tools.map(t => t.name)).toEqual(["search_skills", "buy_skill", "post_skill_comment", "post_agent_comment"]);
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

  it("should handle post_skill_comment tool call", async () => {
    vi.mocked(postNote).mockResolvedValue("note:abc:123:xyz");
    const result = await handleToolCall(mockConn, signer, "defaultCreator", "post_skill_comment", {
      skillId: "skill1",
      collectionId: "col1",
      text: "Great skill!",
      gitLink: "https://github.com/example",
    });
    expect(result.content[0].text).toContain("note:abc:123:xyz");
    expect(postNote).toHaveBeenCalledWith(mockConn, signer, {
      collectionId: "col1",
      skillId: "skill1",
      text: "Great skill!",
      gitLink: "https://github.com/example",
    });
  });

  it("should surface gate error for post_skill_comment", async () => {
    vi.mocked(postNote).mockRejectedValue(new Error("Must own ≥1 skill token to post note (balance: 0)"));
    const result = await handleToolCall(mockConn, signer, "defaultCreator", "post_skill_comment", {
      skillId: "skill1",
      collectionId: "col1",
      text: "No token",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Must own");
  });

  it("should handle post_agent_comment tool call", async () => {
    vi.mocked(postAgentNote).mockResolvedValue("note:agent:123:xyz");
    const result = await handleToolCall(mockConn, signer, "defaultCreator", "post_agent_comment", {
      agentWallet: "agentWallet1",
      text: "Awesome agent!",
    });
    expect(result.content[0].text).toContain("note:agent:123:xyz");
    expect(postAgentNote).toHaveBeenCalledWith(mockConn, signer, {
      agentWallet: "agentWallet1",
      text: "Awesome agent!",
      gitLink: undefined,
    });
  });

  it("should surface gate error for post_agent_comment", async () => {
    vi.mocked(postAgentNote).mockRejectedValue(new Error("Must hold ≥1 of agentWallet1's skills to comment"));
    const result = await handleToolCall(mockConn, signer, "defaultCreator", "post_agent_comment", {
      agentWallet: "agentWallet1",
      text: "Not a holder",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Must hold");
  });

  it("should throw on unknown tool", async () => {
    await expect(handleToolCall(mockConn, signer, "defaultCreator", "unknown_tool", {})).rejects.toThrow("Unknown tool");
  });
});
