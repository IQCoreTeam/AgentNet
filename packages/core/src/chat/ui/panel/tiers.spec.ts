// Pins the AgentNet rank tables and tier math (chat/ui/panel/tiers.ts) at every threshold, so
// the #215 module port cannot move a boundary that both the agent card and the profile gauge read.
import { describe, it, expect } from "vitest";
import { hashSeed } from "../avatar.js";
import {
  AG_SEG, AG_TIERS, agStarTier, agNextTierMin, agAccent,
  PROF_TIERS, TIER_COLOR, PROF_SEG, profTierInfo,
  PROF_REPO_TIERS, PROF_REPO_BASE, profRepoTier, profRepoFill,
} from "./tiers.js";

const W = "C3EPAsjHq6DHLDzG2bXySFpUYmQ5AUqDXDfEiEsCekrH";

describe("panel/tiers: the agent card's star tier", () => {
  it("names the tier at each boundary; under 3 stars is unranked (null)", () => {
    const name = (stars) => { const t = agStarTier(stars); return t ? t.name : null; };
    expect(name(0)).toBe(null);
    expect(name(2)).toBe(null);
    expect(name(3)).toBe("Bronze");
    expect(name(14)).toBe("Bronze");
    expect(name(15)).toBe("Silver");
    expect(name(59)).toBe("Silver");
    expect(name(60)).toBe("Gold");
    expect(name(249)).toBe("Gold");
    expect(name(250)).toBe("Legendary");
    expect(name(10_000)).toBe("Legendary");
  });
  it("agNextTierMin is the next threshold, and stays at the top once Legendary", () => {
    expect(agNextTierMin(0)).toBe(3);
    expect(agNextTierMin(2)).toBe(3);
    expect(agNextTierMin(3)).toBe(15);
    expect(agNextTierMin(14)).toBe(15);
    expect(agNextTierMin(15)).toBe(60);
    expect(agNextTierMin(59)).toBe(60);
    expect(agNextTierMin(60)).toBe(250);
    expect(agNextTierMin(249)).toBe(250);
    expect(agNextTierMin(250)).toBe(250);
    expect(agNextTierMin(10_000)).toBe(250);
  });
  it("the card and the profile share one threshold ladder; AG_TIERS stays descending for find()", () => {
    expect(AG_SEG).toBe(12);
    expect(AG_TIERS.map((t) => t.min)).toEqual([250, 60, 15, 3]);
    expect([...AG_TIERS].sort((a, b) => a.min - b.min)).toEqual(PROF_TIERS);
  });
  it("agAccent is the avatar hash's hue, so a wallet's accent matches its face", () => {
    expect(agAccent(W)).toBe("hsl(" + (hashSeed(W) % 360) + " 46% 62%)");
    expect(agAccent(W)).toMatch(/^hsl\(\d{1,3} 46% 62%\)$/);
    expect(agAccent("")).toBe(agAccent("default"));
    expect(agAccent(undefined)).toBe(agAccent("default"));
  });
});

describe("panel/tiers: the profile gauge", () => {
  it("profTierInfo pairs the reached tier with the next one, null at either end", () => {
    expect(profTierInfo(0)).toEqual({ cur: null, next: PROF_TIERS[0] });
    expect(profTierInfo(2)).toEqual({ cur: null, next: PROF_TIERS[0] });
    expect(profTierInfo(3)).toEqual({ cur: PROF_TIERS[0], next: PROF_TIERS[1] });
    expect(profTierInfo(14)).toEqual({ cur: PROF_TIERS[0], next: PROF_TIERS[1] });
    expect(profTierInfo(15)).toEqual({ cur: PROF_TIERS[1], next: PROF_TIERS[2] });
    expect(profTierInfo(60)).toEqual({ cur: PROF_TIERS[2], next: PROF_TIERS[3] });
    expect(profTierInfo(249)).toEqual({ cur: PROF_TIERS[2], next: PROF_TIERS[3] });
    expect(profTierInfo(250)).toEqual({ cur: PROF_TIERS[3], next: null });
  });
  it("every tier has its CSS colour token and the gauge has 15 segments", () => {
    expect(PROF_SEG).toBe(15);
    for (const t of PROF_TIERS) expect(TIER_COLOR[t.name]).toBe("var(--an-tier-" + t.name.toLowerCase() + ")");
  });
});

describe("panel/tiers: the per-repo tier ramp (3/10/50/250)", () => {
  it("profRepoTier is the base palette under 3 stars, then the highest rung reached", () => {
    expect(profRepoTier(0)).toBe(PROF_REPO_BASE);
    expect(profRepoTier(2)).toBe(PROF_REPO_BASE);
    expect(profRepoTier(3)).toBe(PROF_REPO_TIERS[3]);
    expect(profRepoTier(9)).toBe(PROF_REPO_TIERS[3]);
    expect(profRepoTier(10)).toBe(PROF_REPO_TIERS[2]);
    expect(profRepoTier(50)).toBe(PROF_REPO_TIERS[1]);
    expect(profRepoTier(250)).toBe(PROF_REPO_TIERS[0]);
    expect(profRepoTier(99_999)).toBe(PROF_REPO_TIERS[0]);
    expect(PROF_REPO_TIERS.map((t) => t.min)).toEqual([250, 50, 10, 3]);
  });
  it("profRepoFill is tenths of the way to the next rung, full (10) at and past 250", () => {
    expect(profRepoFill(0)).toBe(0);
    expect(profRepoFill(1)).toBe(3);
    expect(profRepoFill(2)).toBe(7);
    expect(profRepoFill(3)).toBe(3);
    expect(profRepoFill(9)).toBe(9);
    expect(profRepoFill(10)).toBe(2);
    expect(profRepoFill(25)).toBe(5);
    expect(profRepoFill(50)).toBe(2);
    expect(profRepoFill(249)).toBe(10);
    expect(profRepoFill(250)).toBe(10);
    expect(profRepoFill(99_999)).toBe(10);
  });
});
