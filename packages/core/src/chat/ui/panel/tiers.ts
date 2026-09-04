// Panel module cut from the legacy webview script (issue #215). Bodies are verbatim apart from
// the S.<name> state rewrite.
import { hashSeed } from "../avatar.js";

export const AG_SEG = 12; // STARS gauge segment count
export const AG_TIERS = [
  { name: 'Legendary', min: 250 },
  { name: 'Gold', min: 60 },
  { name: 'Silver', min: 15 },
  { name: 'Bronze', min: 3 },
];
export function agStarTier(stars) { return AG_TIERS.find((t) => stars >= t.min) || null; }
export function agNextTierMin(stars) {
  const asc = AG_TIERS.slice().sort((a, b) => a.min - b.min); // bronze..legendary
  const up = asc.find((t) => t.min > stars);
  return up ? up.min : asc[asc.length - 1].min;
}
// One stable accent per identity (mobile derives it from the avatar's hue). hashSeed is the
// avatar module's own, so the same wallet always gets the same accent as its face.
export function agAccent(wallet) { return 'hsl(' + (hashSeed(wallet || 'default') % 360) + ' 46% 62%)'; }
export const PROF_TIERS = [ { name: 'Bronze', min: 3 }, { name: 'Silver', min: 15 }, { name: 'Gold', min: 60 }, { name: 'Legendary', min: 250 } ];
export const TIER_COLOR = { Bronze: 'var(--an-tier-bronze)', Silver: 'var(--an-tier-silver)', Gold: 'var(--an-tier-gold)', Legendary: 'var(--an-tier-legendary)' };
export const PROF_SEG = 15;
export function profTierInfo(stars) {
  let cur = null, next = null;
  for (const t of PROF_TIERS) { if (stars >= t.min) cur = t; else { next = t; break; } }
  return { cur: cur, next: next };
}
// Per-repo tier ramp (3/10/50/250) — drives the folder screen tint, star colour, gauge fill.
export const PROF_REPO_TIERS = [
  { min: 250, color: '#86c4cf', from: '#131a1b', to: '#0d1011', empty: '#1e2628' },
  { min: 50,  color: '#d8c074', from: '#1a1813', to: '#100f0d', empty: '#2a2618' },
  { min: 10,  color: '#b8c0cc', from: '#161719', to: '#0e0f10', empty: '#26282c' },
  { min: 3,   color: '#b8895a', from: '#1a1613', to: '#100f0e', empty: '#2a2420' },
];
export const PROF_REPO_BASE = { color: '#9a9a9a', from: '#1a1a1d', to: '#0d0d0e', empty: '#33333a' };
export function profRepoTier(stars) { return PROF_REPO_TIERS.find((t) => stars >= t.min) || PROF_REPO_BASE; }
export function profRepoFill(stars) { const next = [3, 10, 50, 250].find((t) => stars < t); if (!next) return 10; return Math.max(0, Math.min(10, Math.round((stars / next) * 10))); }
