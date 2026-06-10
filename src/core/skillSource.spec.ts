import { describe, it, expect, vi, beforeEach } from "vitest";
import { indexTableSource } from "./skillSource.js";
import * as chain from "./chain.js";

vi.mock("./chain.js", () => ({
  readRows: vi.fn(),
}));

vi.mock("./seed.js", () => ({
  SKILLS_INDEX_HINT: "skills:index",
}));

describe("core/skillSource", () => {
  beforeEach(() => vi.clearAllMocks());

  it("indexTableSource reads the index table and keeps rows with a string id", async () => {
    vi.mocked(chain.readRows).mockResolvedValue([
      { id: "skill1", name: "A", creator: "w1" },
      { id: "skill2", creator: "w2" }, // sparse but valid (has id)
      { signature: "sig", metadata: "{}" }, // metadata entry — dropped (no id)
      { metadata: "x" },
    ] as any);

    const skills = await indexTableSource.listSkills();

    expect(skills.map((s) => s.id)).toEqual(["skill1", "skill2"]);
    expect(chain.readRows).toHaveBeenCalledWith("skills:index", { limit: 1000 });
  });

  it("passes a custom limit through to the table read", async () => {
    vi.mocked(chain.readRows).mockResolvedValue([]);
    await indexTableSource.listSkills(50);
    expect(chain.readRows).toHaveBeenCalledWith("skills:index", { limit: 50 });
  });
});
