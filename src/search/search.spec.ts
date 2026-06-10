import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchSkills } from "./search.js";
import { readRows } from "../core/chain.js";

vi.mock("../core/chain.js", () => ({
  readRows: vi.fn(),
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
});
