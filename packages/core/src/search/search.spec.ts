import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchSkills } from "./search.js";
import { getMintSupply } from "../nft/token2022.js";
import type { SkillSource } from "../core/skillSource.js";

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

const mockSkills = [
  { id: "A", name: "Apple", description: "red fruit", category: "food", hashtags: ["sweet"], supply: 10, createdAt: 100, type: "skill" },
  { id: "B", name: "Banana", description: "yellow fruit", category: "food", hashtags: ["sweet", "potassium"], supply: 50, createdAt: 200, type: "skill" },
  { id: "C", name: "Carrot", description: "orange veg", category: "veg", hashtags: ["crunchy"], supply: 5, createdAt: 300, type: "workflow" },
];

// A fresh copy each call (search mutates supply/traits in place during hydration).
const fakeSource = (): SkillSource => ({
  listSkills: vi.fn().mockResolvedValue(mockSkills.map((s) => ({ ...s }))),
});

describe("search/search", () => {
  let mockConn: any;

  beforeEach(() => {
    mockConn = {}; // Connection is not actually used in our mock implementation
    vi.clearAllMocks();
  });

  it("should return all skills without filters, sorted by supply by default", async () => {
    const results = await searchSkills(mockConn, { source: fakeSource() });

    expect(results.length).toBe(3);
    // sorted by supply descending: 50, 10, 5
    expect(results[0].id).toBe("B");
    expect(results[1].id).toBe("A");
    expect(results[2].id).toBe("C");
  });

  it("should filter by keyword in name or description", async () => {
    const results = await searchSkills(mockConn, { source: fakeSource(), filters: { keyword: "fruit" } });

    expect(results.length).toBe(2);
    expect(results.some((s) => s.id === "A")).toBe(true);
    expect(results.some((s) => s.id === "B")).toBe(true);
  });

  it("should filter by category", async () => {
    const results = await searchSkills(mockConn, { source: fakeSource(), filters: { category: "food" } });

    expect(results.length).toBe(2);
    expect(results.some((s) => s.id === "A")).toBe(true);
    expect(results.some((s) => s.id === "B")).toBe(true);
  });

  it("should filter by hashtags", async () => {
    const results = await searchSkills(mockConn, { source: fakeSource(), filters: { hashtags: ["crunchy"] } });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("C");
  });

  it("should filter by type", async () => {
    const skills = await searchSkills(mockConn, { source: fakeSource(), filters: { type: "skill" } });
    expect(skills.length).toBe(2);
    expect(skills.map((s) => s.id)).toEqual(expect.arrayContaining(["A", "B"]));

    const workflows = await searchSkills(mockConn, { source: fakeSource(), filters: { type: "workflow" } });
    expect(workflows.length).toBe(1);
    expect(workflows[0].id).toBe("C");
  });

  it("should sort by name", async () => {
    const results = await searchSkills(mockConn, { source: fakeSource(), sortBy: "name" });

    expect(results.length).toBe(3);
    expect(results[0].id).toBe("A");
    expect(results[1].id).toBe("B");
    expect(results[2].id).toBe("C");
  });

  it("should sort by recent", async () => {
    const results = await searchSkills(mockConn, { source: fakeSource(), sortBy: "recent" });

    expect(results.length).toBe(3);
    // descending by createdAt: 300, 200, 100
    expect(results[0].id).toBe("C");
    expect(results[1].id).toBe("B");
    expect(results[2].id).toBe("A");
  });

  it("uses the provided source for enumeration", async () => {
    const source = { listSkills: vi.fn().mockResolvedValue([{ ...mockSkills[2] }]) };

    const results = await searchSkills(mockConn, { source });

    expect(source.listSkills).toHaveBeenCalled();
    expect(results.map((s) => s.id)).toEqual(["C"]);
  });

  it("verifyTraits re-reads category from the mint, overriding the stale snapshot", async () => {
    // Chain says A is actually "tech", not the snapshot "food".
    META_BY_ID["A"] = { category: "tech", hashtags: ["sweet"] };

    const cached = await searchSkills(mockConn, { source: fakeSource(), filters: { category: "tech" } });
    expect(cached.length).toBe(0); // snapshot copy still says "food"

    const verified = await searchSkills(mockConn, {
      source: fakeSource(),
      filters: { category: "tech" },
      verifyTraits: true,
    });
    expect(verified.map((s) => s.id)).toEqual(["A"]);

    delete META_BY_ID["A"];
  });

  it("a hydrated source skips the per-mint getMintSupply loop", async () => {
    // Source carries its own (already-live) supply; sort must use it WITHOUT
    // any getMintSupply call. Use supplies that differ from SUPPLY_BY_ID so a
    // stray hydration would reorder and be caught.
    const hydrated: SkillSource = {
      hydrated: true,
      listSkills: vi.fn().mockResolvedValue([
        { ...mockSkills[0], supply: 1 },   // A
        { ...mockSkills[1], supply: 999 }, // B (highest via source value)
        { ...mockSkills[2], supply: 2 },   // C
      ]),
    };

    const results = await searchSkills(mockConn, { source: hydrated, sortBy: "supply" });

    expect(getMintSupply).not.toHaveBeenCalled();
    expect(results.map((s) => s.id)).toEqual(["B", "C", "A"]); // 999 > 2 > 1
  });
});
