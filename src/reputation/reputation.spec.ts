import { describe, it, expect, vi, beforeEach } from "vitest";
import { Keypair } from "@solana/web3.js";
import { getReputation, updateReputation, getLeaderboard } from "./reputation.js";
import * as chain from "../core/chain.js";

vi.mock("../core/chain.js", () => ({
  readRows: vi.fn(),
  writeRow: vi.fn().mockResolvedValue("mockWriteSig"),
}));

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
      if (hint === "audit:skills") return mockSkills as any;
      if (hint === "notes:skill:skill1") return [{ id: "note1" }, { id: "note2" }] as any;
      if (hint === "notes:skill:skill2") return [{ id: "note3" }] as any;
      return [];
    });

    const rep = await getReputation(mockConn, "walletA");

    // skillsPublished = 2
    // totalSupply = 7
    // notesReceived = 3
    // score = (7 * 3) + (2 * 10) + 3 = 21 + 20 + 3 = 44
    expect(rep.wallet).toBe("walletA");
    expect(rep.skillsPublished).toBe(2);
    expect(rep.totalSupply).toBe(7);
    expect(rep.notesReceived).toBe(3);
    expect(rep.score).toBe(44);
  });

  it("should update reputation and write row to chain", async () => {
    vi.mocked(chain.readRows).mockResolvedValue([]); // empty skills

    const rep = await updateReputation(mockConn, signer, "walletC");
    
    expect(rep.score).toBe(0);
    expect(chain.writeRow).toHaveBeenCalledWith(signer, "reputation:walletC", expect.any(String));
  });

  it("should generate leaderboard correctly", async () => {
    const mockSkills = [
      { id: "skill1", creator: "walletA", supply: 5 }, // walletA score: (5*3) + (1*10) = 25
      { id: "skill2", creator: "walletB", supply: 10 }, // walletB score: (10*3) + (1*10) = 40
    ];
    vi.mocked(chain.readRows).mockResolvedValue(mockSkills as any);

    const leaderboard = await getLeaderboard(mockConn, 10);
    
    expect(leaderboard.length).toBe(2);
    expect(leaderboard[0].wallet).toBe("walletB"); // 40
    expect(leaderboard[1].wallet).toBe("walletA"); // 25
  });
});
