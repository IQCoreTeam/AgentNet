import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchSkills } from "./search.js";
import { readRows } from "../core/chain.js";

vi.mock("../core/chain.js", () => ({
  readRows: vi.fn(),
}));

// Live supply is hydrated from the mint; echo the per-id supply set below.
const SUPPLY_BY_ID: Record<string, number> = { A: 10, B: 50, C: 5 };
// On-chain trait override used by the verifyTraits test.
const META_BY_ID: Record<string, { category?: string; hashtags?: string[] }> = {};
vi.mock("../nft/token2022.js", () => ({
  getMintSupply: vi.fn((_conn: any, id: string) =>
    Promise.resolve(SUPPLY_BY_ID[id] ?? 0),
  ),
  readSkillMintMetadata: vi.fn((_conn: any, id: string) =>
    Promise.resolve(META_BY_ID[id] ?? null),
  ),
}));

describe("search/search", () => {
  let mockConn: any;

  beforeEach(() => {
    mockConn = {}; // Connection is not actually used in our mock implementation
    vi.clearAllMocks();
  });

  const mockSkills = [
    { id: "A", name: "Apple", description: "red fruit", category: "food", hashtags: ["sweet"], supply: 10, createdAt: 100, type: "skill" },
    { id: "B", name: "Banana", description: "yellow fruit", category: "food", hashtags: ["sweet", "potassium"], supply: 50, createdAt: 200, type: "skill" },
    { id: "C", name: "Carrot", description: "orange veg", category: "veg", hashtags: ["crunchy"], supply: 5, createdAt: 300, type: "workflow" },
  ];

  it("should return all skills without filters, sorted by supply by default", async () => {
    vi.mocked(readRows).mockResolvedValue(mockSkills as any);

    const results = await searchSkills(mockConn);
    
    expect(results.length).toBe(3);
    // sorted by supply descending: 50, 10, 5
    expect(results[0].id).toBe("B");
    expect(results[1].id).toBe("A");
    expect(results[2].id).toBe("C");
  });

  it("should filter by keyword in name or description", async () => {
    vi.mocked(readRows).mockResolvedValue(mockSkills as any);

    const results = await searchSkills(mockConn, { filters: { keyword: "fruit" } });
    
    expect(results.length).toBe(2);
    expect(results.some((s) => s.id === "A")).toBe(true);
    expect(results.some((s) => s.id === "B")).toBe(true);
  });

  it("should filter by category", async () => {
    vi.mocked(readRows).mockResolvedValue(mockSkills as any);

    const results = await searchSkills(mockConn, { filters: { category: "food" } });
    
    expect(results.length).toBe(2);
    expect(results.some((s) => s.id === "A")).toBe(true);
    expect(results.some((s) => s.id === "B")).toBe(true);
  });

  it("should filter by hashtags", async () => {
    vi.mocked(readRows).mockResolvedValue(mockSkills as any);

    const results = await searchSkills(mockConn, { filters: { hashtags: ["crunchy"] } });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("C");
  });

  it("should filter by type", async () => {
    vi.mocked(readRows).mockResolvedValue(mockSkills as any);

    const skills = await searchSkills(mockConn, { filters: { type: "skill" } });
    expect(skills.length).toBe(2);
    expect(skills.map((s) => s.id)).toEqual(expect.arrayContaining(["A", "B"]));

    const workflows = await searchSkills(mockConn, { filters: { type: "workflow" } });
    expect(workflows.length).toBe(1);
    expect(workflows[0].id).toBe("C");
  });

  it("should sort by name", async () => {
    vi.mocked(readRows).mockResolvedValue(mockSkills as any);

    const results = await searchSkills(mockConn, { sortBy: "name" });
    
    expect(results.length).toBe(3);
    expect(results[0].id).toBe("A");
    expect(results[1].id).toBe("B");
    expect(results[2].id).toBe("C");
  });

  it("should sort by recent", async () => {
    vi.mocked(readRows).mockResolvedValue(mockSkills as any);

    const results = await searchSkills(mockConn, { sortBy: "recent" });

    expect(results.length).toBe(3);
    // descending by createdAt: 300, 200, 100
    expect(results[0].id).toBe("C");
    expect(results[1].id).toBe("B");
    expect(results[2].id).toBe("A");
  });

  it("uses a custom source for enumeration instead of the index table", async () => {
    const source = { listSkills: vi.fn().mockResolvedValue([mockSkills[2]]) };

    const results = await searchSkills(mockConn, { source });

    expect(source.listSkills).toHaveBeenCalled();
    expect(readRows).not.toHaveBeenCalled(); // index table bypassed
    expect(results.map((s) => s.id)).toEqual(["C"]);
  });

  it("verifyTraits re-reads category from the mint, overriding the stale cache", async () => {
    vi.mocked(readRows).mockResolvedValue(mockSkills as any);
    // Chain says A is actually "tech", not the cached "food".
    META_BY_ID["A"] = { category: "tech", hashtags: ["sweet"] };

    const cached = await searchSkills(mockConn, { filters: { category: "tech" } });
    expect(cached.length).toBe(0); // cache copy still says "food"

    const verified = await searchSkills(mockConn, {
      filters: { category: "tech" },
      verifyTraits: true,
    });
    expect(verified.map((s) => s.id)).toEqual(["A"]);

    delete META_BY_ID["A"];
  });
});
