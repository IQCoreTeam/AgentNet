import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getReputation, getLeaderboard } from "./reputation.js";
import * as chain from "../core/chain.js";
import { dasSource } from "../core/skillSource.js";
import { getMintSupply } from "../nft/token2022.js";
import { reviewsHint, collectionFor } from "../core/seed.js";

vi.mock("../core/chain.js", () => ({
  readRows: vi.fn(),
}));

// Skill enumeration comes from the DAS collection scan; each test stubs it.
vi.mock("../core/skillSource.js", () => ({
  dasSource: { listSkills: vi.fn() },
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
  const origEnv = { ...process.env };

  beforeEach(() => {
    mockConn = {};
    vi.clearAllMocks();
    // No collection configured → collectionFor returns "" → review key is
    // "reviews::<id>". That's a stable key the test reads back below.
    delete process.env.AGENTNET_SKILLS_COLLECTION_PUBKEY;
    delete process.env.AGENTNET_WORKFLOWS_COLLECTION_PUBKEY;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("computes reputation from skills (supply) + reviews (count), not a score", async () => {
    vi.mocked(dasSource.listSkills).mockResolvedValue([
      { id: "skill1", type: "skill", creator: "walletA", supply: 5 } as any,
      { id: "skill2", type: "skill", creator: "walletA", supply: 2 } as any,
      { id: "skill3", type: "skill", creator: "walletB", supply: 10 } as any,
    ]);
    // Review hint uses the configured collection — build it the same way the code
    // does, so it matches regardless of the default collection id.
    const coll = collectionFor("skill");
    vi.mocked(chain.readRows).mockImplementation(async (hint: string) => {
      if (hint === reviewsHint(coll, "skill1")) return [{ id: "n1" }, { id: "n2" }] as any;
      if (hint === reviewsHint(coll, "skill2")) return [{ id: "n3" }] as any;
      return [];
    });
    mockSupply({ skill1: 5, skill2: 2, skill3: 10 });

    const rep = await getReputation(mockConn, "walletA");

    // Standing = totalSupply (fame); notes informational.
    expect(rep.wallet).toBe("walletA");
    expect(rep.skillsPublished).toBe(2);
    expect(rep.totalSupply).toBe(7);
    expect(rep.notesReceived).toBe(3);
    expect(rep).not.toHaveProperty("score");
  });

  it("generates a leaderboard ranked by totalSupply", async () => {
    vi.mocked(dasSource.listSkills).mockResolvedValue([
      { id: "skill1", type: "skill", creator: "walletA", supply: 5 } as any,
      { id: "skill2", type: "skill", creator: "walletB", supply: 10 } as any,
    ]);
    vi.mocked(chain.readRows).mockResolvedValue([] as any);
    mockSupply({ skill1: 5, skill2: 10 });

    const leaderboard = await getLeaderboard(mockConn, 10);

    expect(leaderboard.length).toBe(2);
    expect(leaderboard[0].wallet).toBe("walletB"); // totalSupply 10
    expect(leaderboard[1].wallet).toBe("walletA"); // totalSupply 5
  });
});
