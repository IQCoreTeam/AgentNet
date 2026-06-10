import { describe, it, expect, vi, beforeEach } from "vitest";
import { Keypair } from "@solana/web3.js";
import { getReputation, updateReputation, getLeaderboard } from "./reputation.js";
import * as chain from "../core/chain.js";
import { getMintSupply } from "../nft/token2022.js";

vi.mock("../core/chain.js", () => ({
  readRows: vi.fn(),
  writeRow: vi.fn().mockResolvedValue("mockWriteSig"),
  ensureTable: vi.fn().mockResolvedValue(null),
}));

// Live supply is hydrated from the mint; each test sets its own id→supply map.
vi.mock("../nft/token2022.js", () => ({
  getMintSupply: vi.fn(),
}));

function mockSupply(map: Record<string, number>) {
  vi.mocked(getMintSupply).mockImplementation((_conn: any, id: string) =>
    Promise.resolve(map[id] ?? 0),
  );
}

describe("reputation/reputation", () => {
  let mockConn: any;
  let signer: Keypair;

  beforeEach(() => {
    mockConn = {};
    signer = Keypair.generate();
    vi.clearAllMocks();
  });

  it("should compute reputation correctly based on skills and notes", async () => {
    const mockSkills = [
      { id: "skill1", creator: "walletA", supply: 5 },
      { id: "skill2", creator: "walletA", supply: 2 },
      { id: "skill3", creator: "walletB", supply: 10 },
    ];
    
    vi.mocked(chain.readRows).mockImplementation(async (hint: string) => {
      if (hint === "skills:index") return mockSkills as any;
      if (hint === "notes:skill:skill1") return [{ id: "note1" }, { id: "note2" }] as any;
      if (hint === "notes:skill:skill2") return [{ id: "note3" }] as any;
      return [];
    });
    mockSupply({ skill1: 5, skill2: 2, skill3: 10 });

    const rep = await getReputation(mockConn, "walletA");

    // Reputation is NOT a score. Standing = totalSupply (fame); notes informational.
    // skillsPublished = 2, totalSupply = 5 + 2 = 7, notesReceived = 3
    expect(rep.wallet).toBe("walletA");
    expect(rep.skillsPublished).toBe(2);
    expect(rep.totalSupply).toBe(7);
    expect(rep.notesReceived).toBe(3);
    expect(rep).not.toHaveProperty("score");
  });

  it("should update reputation and write row to chain", async () => {
    vi.mocked(chain.readRows).mockResolvedValue([]); // empty skills
    mockSupply({});

    const rep = await updateReputation(mockConn, signer, "walletC");

    expect(rep.totalSupply).toBe(0);
    expect(chain.writeRow).toHaveBeenCalledWith(signer, "reputation:walletC", expect.any(String));
  });

  it("should generate leaderboard correctly", async () => {
    const mockSkills = [
      { id: "skill1", creator: "walletA", supply: 5 }, // walletA totalSupply: 5
      { id: "skill2", creator: "walletB", supply: 10 }, // walletB totalSupply: 10
    ];
    vi.mocked(chain.readRows).mockResolvedValue(mockSkills as any);
    mockSupply({ skill1: 5, skill2: 10 });

    const leaderboard = await getLeaderboard(mockConn, 10);
    
    expect(leaderboard.length).toBe(2);
    expect(leaderboard[0].wallet).toBe("walletB"); // totalSupply 10
    expect(leaderboard[1].wallet).toBe("walletA"); // totalSupply 5
  });
});
