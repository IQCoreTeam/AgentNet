// Agent tier math — ported from surfaces/webview/src/market/AgentProfileView.tsx.
// Reputation.stars (summed verified-work GitHub stars) maps to a tier badge + a
// progress gauge toward the next tier. Kept as pure functions so both the agent
// directory row and the profile ladder can share one source of truth.
import React from "react";
import { Text } from "ink";
import { colors } from "../../theme.js";

export interface Tier {
  name: string;
  min: number;
}

export const STAR_TIERS: Tier[] = [
  { name: "Bronze", min: 3 },
  { name: "Silver", min: 15 },
  { name: "Gold", min: 60 },
  { name: "Legendary", min: 250 },
];

export function tierInfo(stars: number): { cur: Tier | null; next: Tier | null } {
  let cur: Tier | null = null;
  let next: Tier | null = null;
  for (const t of STAR_TIERS) {
    if (stars >= t.min) cur = t;
    else { next = t; break; }
  }
  return { cur, next };
}

// 15-segment gauge toward the next tier ("MAX" once past Legendary), split into its
// lit/unlit halves so render sites can two-tone it (design tab 21 paints the filled
// segments signal green and the remainder dim; the gauge is progress, not a flat rune).
export function tierGaugeParts(stars: number, segments = 15): { lit: string; unlit: string; label: string } {
  const { cur, next } = tierInfo(stars);
  if (!next) return { lit: "█".repeat(segments), unlit: "", label: " MAX" };
  const prevMin = cur?.min ?? 0;
  const pct = Math.max(0, Math.min(1, (stars - prevMin) / (next.min - prevMin)));
  const lit = Math.round(pct * segments);
  return { lit: "█".repeat(lit), unlit: "░".repeat(segments - lit), label: ` ${stars}/${next.min}` };
}

// The joined plain string; the self-check and any text-measuring caller use this.
export function tierGauge(stars: number, segments = 15): string {
  const p = tierGaugeParts(stars, segments);
  return p.lit + p.unlit + p.label;
}

// The gauge as ink text: ONE component shared by the directory's selected row and the
// profile hero, so the two reputation screens can never disagree about the gauge again
// (they shipped amber-vs-bone). Lit segments signal green, the rest and the count dim.
export function TierGauge({ stars, segments = 15 }: { stars: number; segments?: number }) {
  const p = tierGaugeParts(stars, segments);
  // The gauge owns its ONE terminal label: at MAX the word wears the same green as
  // the lit segments (an achieved state, like owned and earned), while a progress
  // count ("74/250") stays dim metadata. Render sites must never append their own
  // MAX beside this component; the profile hero once did and printed "MAX  MAX".
  return (
    <Text>
      <Text color={colors.ok}>{p.lit}</Text>
      <Text dimColor>{p.unlit}</Text>
      {p.label === " MAX" ? <Text color={colors.ok}>{p.label}</Text> : <Text dimColor>{p.label}</Text>}
    </Text>
  );
}

// Per-repo star gauge (verified-repo rows) — separate breakpoints from the agent tier.
const REPO_BREAKPOINTS = [3, 10, 50, 250];

export function repoGaugeFill(stars: number, segments = 10): number {
  const next = REPO_BREAKPOINTS.find((t) => stars < t);
  if (!next) return segments;
  return Math.max(0, Math.min(segments, Math.round((stars / next) * segments)));
}

export function repoGauge(stars: number, segments = 10): string {
  const lit = repoGaugeFill(stars, segments);
  return "█".repeat(lit) + "░".repeat(segments - lit);
}

// ponytail: assert-based self-check, no test framework — run with `node --experimental-strip-types tiers.ts` style tooling if needed.
export function __selfCheck(): void {
  const assert = (cond: boolean, msg: string) => { if (!cond) throw new Error(`tiers self-check failed: ${msg}`); };
  assert(tierInfo(0).cur === null && tierInfo(0).next?.name === "Bronze", "0 stars -> no tier, next Bronze");
  assert(tierInfo(3).cur?.name === "Bronze", "3 stars -> Bronze");
  assert(tierInfo(14).cur?.name === "Bronze" && tierInfo(14).next?.name === "Silver", "14 stars -> Bronze, next Silver");
  assert(tierInfo(250).cur?.name === "Legendary" && tierInfo(250).next === null, "250 stars -> Legendary, no next (MAX)");
  assert(tierInfo(300).next === null, "past Legendary -> no next");
  assert(tierGauge(300).endsWith("MAX"), "gauge shows MAX past Legendary");
  assert(repoGaugeFill(0) === 0 && repoGaugeFill(250) === 10, "repo gauge clamps 0..10");
}
