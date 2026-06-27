// Deterministic art for skill collectible cards. From a skill's name we derive (1) a colour
// (hue chosen by the skill's CATEGORY, jittered by the name so siblings vary) and (2) a
// "magic-circle" sigil SVG — concentric rings, radial ticks, an inscribed polygon/star, rune
// marks. Same name => same art, always. Not AI; just a seeded PRNG, like the wallet avatar.

// FNV-1a string hash -> 32-bit seed.
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32 PRNG — deterministic float stream in [0,1) from a seed.
function rngFor(s: string): () => number {
  let a = hashSeed(s);
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Category -> base hue. Same category reads as one colour family; the name jitters within it.
// A sanctioned multi-hue set for the collectible cards (design-system §6 collectible loot).
const CAT_HUE: Record<string, number> = {
  code: 208,
  coding: 208,
  dev: 230,
  developer: 230,
  productivity: 145,
  prod: 145,
  research: 272,
  writing: 34,
  write: 34,
  docs: 40,
  design: 326,
  test: 182,
  testing: 182,
  data: 175,
  api: 196,
  security: 6,
  finance: 96,
  workflow: 286,
};

// Deterministic {hue, sat, light} for a skill — fresh PRNG each call so colour + sigil match.
// Deep + desaturated (not pastel) so the card body reads as a classy muted plastic, not neon.
function paletteFor(name: string, category?: string): { hue: number; sat: number; light: number } {
  const r = rngFor(name);
  const key = category?.toLowerCase().trim();
  const base = key && CAT_HUE[key] != null ? CAT_HUE[key] : 250; // default: slate-violet
  const hue = (base + Math.round((r() - 0.5) * 30) + 360) % 360;
  const sat = 16 + Math.round(r() * 8); // 16-24: muted
  const light = 40 + Math.round(r() * 7); // 40-47: deep
  return { hue, sat, light };
}

// The card body colour (the "SD card" plastic). Category hue + name jitter.
export function skillColor(name: string, category?: string): string {
  const { hue, sat, light } = paletteFor(name, category);
  return `hsl(${hue} ${sat}% ${light}%)`;
}

// The magic-circle sigil, as inner SVG markup for a 120x150 viewBox. Light tint of the card hue.
export function skillSigilSvg(name: string, category?: string): string {
  // Neutral light grey — the cartridge is now a chic grey, so the sigil reads as a mono backdrop
  // (the SHAPE still varies per name; only the colour is fixed).
  const col = "hsl(228 5% 82%)";
  const r = rngFor(name + "::sigil");
  const cx = 60;
  const cy = 74;
  let s = "";

  // concentric rings
  const rings = 2 + Math.floor(r() * 2);
  for (let i = 0; i < rings; i++) {
    const rad = 22 + i * 9 + r() * 4;
    s += `<circle cx="${cx}" cy="${cy}" r="${rad.toFixed(1)}" fill="none" stroke="${col}" stroke-width="0.7" opacity="${(0.14 + r() * 0.14).toFixed(2)}"/>`;
  }

  // radial ticks around the rim
  const ticks = 12 + Math.floor(r() * 24);
  const t1 = 29 + r() * 3;
  const t2 = t1 + 6 + r() * 4;
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * Math.PI * 2;
    const x1 = cx + Math.cos(a) * t1;
    const y1 = cy + Math.sin(a) * t1;
    const x2 = cx + Math.cos(a) * t2;
    const y2 = cy + Math.sin(a) * t2;
    s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${col}" stroke-width="0.6" opacity="0.2"/>`;
  }

  // inscribed polygon + (for >=5) a star, with rune dots at the vertices
  const sides = 3 + Math.floor(r() * 5); // 3..7
  const rot = r() * Math.PI * 2;
  const pr = 12 + r() * 5;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * pr, cy + Math.sin(a) * pr]);
  }
  const poly = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  s += `<polygon points="${poly}" fill="none" stroke="${col}" stroke-width="0.8" opacity="0.3"/>`;
  if (sides >= 5) {
    const star: Array<[number, number]> = [];
    for (let i = 0; i < sides; i++) star.push(pts[(i * 2) % sides]);
    const sp = star.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    s += `<polygon points="${sp}" fill="none" stroke="${col}" stroke-width="0.6" opacity="0.22"/>`;
  }
  for (const p of pts) {
    s += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${(1 + r() * 1.3).toFixed(1)}" fill="${col}" opacity="0.4"/>`;
  }

  // centre glyph
  s += `<circle cx="${cx}" cy="${cy}" r="${(2 + r() * 3).toFixed(1)}" fill="none" stroke="${col}" stroke-width="0.8" opacity="0.32"/>`;

  // scattered rune ticks
  const runes = 6 + Math.floor(r() * 8);
  for (let i = 0; i < runes; i++) {
    const a = r() * Math.PI * 2;
    const rr = 5 + r() * 28;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    const len = 2 + r() * 4;
    s += `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + len).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${col}" stroke-width="0.6" opacity="${(0.12 + r() * 0.18).toFixed(2)}"/>`;
  }

  return s;
}
