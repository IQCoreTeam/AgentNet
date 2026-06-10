import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchSkills } from "./search.js";
import * as chain from "../core/chain.js";

vi.mock("../core/chain.js", () => ({
  readRows: vi.fn(),
}));

describe("search/search", () => {
  let mockConn: any;

  beforeEach(() => {
    mockConn = {};
    vi.clearAllMocks();
  });

  const mockSkills = [
    {
      id: "skill1",
      name: "React Developer",
      description: "Writes React code",
      category: "frontend",
      hashtags: ["react", "ui"],
      supply: 10,
      createdAt: 1000,
    },
    {
      id: "skill2",
      name: "Backend Node",
      description: "Writes Node backend code",
      category: "backend",
      hashtags: ["node", "api"],
      supply: 20,
      createdAt: 2000,
    },
    {
      id: "skill3",
      name: "Fullstack",
      description: "Writes React and Node",
      category: "fullstack",
      hashtags: ["react", "node"],
      supply: 5,
      createdAt: 3000,
    },
  ];

  it("should return all skills without filters, sorted by supply by default", async () => {
    vi.mocked(chain.readRows).mockResolvedValue(mockSkills as any);

    const results = await searchSkills(mockConn);
    
    expect(results.length).toBe(3);
    // sorted by supply descending: 20, 10, 5
    expect(results[0].id).toBe("skill2");
    expect(results[1].id).toBe("skill1");
    expect(results[2].id).toBe("skill3");
  });

  it("should filter by keyword in name or description", async () => {
    vi.mocked(chain.readRows).mockResolvedValue(mockSkills as any);

    const results = await searchSkills(mockConn, { filters: { keyword: "react" } });
    
    expect(results.length).toBe(2);
    expect(results.some((s) => s.id === "skill1")).toBe(true);
    expect(results.some((s) => s.id === "skill3")).toBe(true);
  });

  it("should filter by category", async () => {
    vi.mocked(chain.readRows).mockResolvedValue(mockSkills as any);

    const results = await searchSkills(mockConn, { filters: { category: "backend" } });
    
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("skill2");
  });

  it("should filter by hashtags", async () => {
    vi.mocked(chain.readRows).mockResolvedValue(mockSkills as any);

    const results = await searchSkills(mockConn, { filters: { hashtags: ["node"] } });
    
    expect(results.length).toBe(2);
    expect(results.some((s) => s.id === "skill2")).toBe(true);
    expect(results.some((s) => s.id === "skill3")).toBe(true);
  });

  it("should sort by name", async () => {
    vi.mocked(chain.readRows).mockResolvedValue(mockSkills as any);

    const results = await searchSkills(mockConn, { sortBy: "name" });
    
    // Backend Node, Fullstack, React Developer
    expect(results[0].id).toBe("skill2");
    expect(results[1].id).toBe("skill3");
    expect(results[2].id).toBe("skill1");
  });

  it("should sort by recent", async () => {
    vi.mocked(chain.readRows).mockResolvedValue(mockSkills as any);

    const results = await searchSkills(mockConn, { sortBy: "recent" });
    
    // 3000, 2000, 1000
    expect(results[0].id).toBe("skill3");
    expect(results[1].id).toBe("skill2");
    expect(results[2].id).toBe("skill1");
  });
});
