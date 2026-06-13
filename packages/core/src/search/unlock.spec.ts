import { describe, it, expect, vi } from "vitest";
import { listUnlockable } from "./unlock.js";
import type { SkillSource } from "../core/skillSource.js";
import type { Skill } from "../core/types.js";

// Three workflows with different prerequisite sets + one plain skill (should be
// ignored). supply is used only as the tie-break.
const wf = (id: string, requiredSkills: string[], supply = 0): Skill => ({
  id, type: "workflow", name: id, description: "", creator: "c",
  category: "", hashtags: [], requiredSkills, supply, price: "0", uriTxid: "", createdAt: 0,
});
const ROWS: Skill[] = [
  wf("wAll", ["s1", "s2"], 10),       // both held → unlockable
  wf("wOne", ["s1", "s3"], 99),       // missing s3 → 1 away
  wf("wTwo", ["s3", "s4"], 5),        // missing s3, s4 → 2 away
  wf("wThree", ["s3", "s4", "s5"]),   // missing 3 → beyond default maxMissing
  { id: "plainSkill", type: "skill", name: "x", description: "", creator: "c",
    category: "", hashtags: [], supply: 0, price: "0", uriTxid: "", createdAt: 0 },
];

const source = (): SkillSource => ({
  hydrated: true,
  listSkills: vi.fn().mockResolvedValue(ROWS.map((r) => ({ ...r }))),
});

describe("search/listUnlockable", () => {
  it("returns unlockable first, then almost-there by fewest missing", async () => {
    const held = ["s1", "s2"]; // can do wAll; 1 away from wOne; 2 from wTwo
    const res = await listUnlockable(held, { source: source() });

    // wThree dropped (3 missing > default maxMissing 2); plainSkill never counts.
    expect(res.map((r) => r.workflow.id)).toEqual(["wAll", "wOne", "wTwo"]);
    expect(res[0].unlockable).toBe(true);
    expect(res[0].missing).toEqual([]);
    expect(res[1].missing).toEqual(["s3"]);
    expect(res[2].missing).toEqual(["s3", "s4"]);
  });

  it("respects maxMissing (0 = only already-unlockable)", async () => {
    const res = await listUnlockable(["s1", "s2"], { source: source(), maxMissing: 0 });
    expect(res.map((r) => r.workflow.id)).toEqual(["wAll"]);
  });

  it("ignores plain skills and prereq-less workflows", async () => {
    const res = await listUnlockable(["s1", "s2", "s3", "s4", "s5"], { source: source() });
    // holding everything → all 4 workflows unlockable; the plain skill is absent.
    expect(res.every((r) => r.workflow.type === "workflow")).toBe(true);
    expect(res.find((r) => r.workflow.id === "plainSkill")).toBeUndefined();
  });

  it("a bogus heldMints is harmless — discovery only, on-chain gate is the truth", async () => {
    // Claiming skills you don't own just labels more workflows unlockable here;
    // buy_workflow would still revert on-chain. No throw, no state change.
    const res = await listUnlockable(["s1", "s2", "s3", "s4"], { source: source() });
    expect(res.find((r) => r.workflow.id === "wTwo")?.unlockable).toBe(true);
  });
});
