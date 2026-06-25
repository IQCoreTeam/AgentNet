import { AVATAR_SVG } from "@iqlabs-official/agent-sdk/chat/ui/avatar";

// Per-wallet character avatar for React surfaces. The art (AVATAR_SVG) stays the single
// source in core; here we only recolor it by a seed derived from the wallet address so
// each wallet gets one stable face. Core already ships the same recolor as AVATAR_SCRIPT,
// but that string targets the injected webview <script> (a non-module runtime), so the
// React profile needs a real module. Same RNG + palette, identical seed -> identical look.

const AVATAR_CLASSES = ["clothes", "eyes", "line", "face_acc"] as const;
const SKIN = "cls-2";

// FNV-1a, matching AVATAR_SCRIPT so a seed renders the same face in both runtimes.
function hashSeed(v: string): number {
  let h = 2166136261;
  for (let i = 0; i < v.length; i++) {
    h ^= v.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// xorshift32 PRNG seeded from the wallet, deterministic per address.
function rng(seed: string): () => number {
  let s = hashSeed(seed || "default") || 0x1a2b3c4d;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// Shared palette: ONE rng pass derives every color, so the recolored SVG and the profile
// band tint always agree for a given wallet. The ORDER of r() calls is significant — keep it.
export function walletAvatarPalette(seed: string): Record<string, string> {
  const r = rng(seed || "default");
  const pal: Record<string, string> = {};
  pal[SKIN] = r() > 0.5 ? "#111111" : "#f6d9c8";
  for (const c of AVATAR_CLASSES) {
    const hue = Math.floor(r() * 360);
    const sat = 50 + Math.floor(r() * 35);
    const lig = 35 + Math.floor(r() * 25);
    pal[c] = `hsl(${hue},${sat}%,${lig}%)`;
  }
  pal["eyes"] = pal[SKIN] === "#111111" ? `hsl(${Math.floor(r() * 360)},80%,75%)` : "#222222";
  return pal;
}

export function walletAvatarSvg(seed: string): string {
  const pal = walletAvatarPalette(seed);
  // Each style rule is literally ".<class>{fill:#xxxxxx}" - find the prefix and splice the
  // new color in up to the closing brace. No regex (avoids escaping pitfalls), mirroring core.
  let svg = AVATAR_SVG;
  for (const c of [...AVATAR_CLASSES, SKIN]) {
    const head = `.${c}{fill:`;
    const i = svg.indexOf(head);
    if (i < 0) continue;
    const end = svg.indexOf("}", i);
    svg = svg.slice(0, i) + head + pal[c] + svg.slice(end);
  }
  return svg;
}

// The avatar's body/"edge" color (clothes) — tints the profile hero band so the background
// reads as the character's own color (the user's "배경은 프사 끝부분 색").
export function walletBandColor(seed: string): string {
  return walletAvatarPalette(seed || "default")["clothes"];
}

// Readable ink (near-black on a light band, near-white on a dark band) for borders/labels
// that must stay legible on the avatar-colored band whatever its hue.
export function walletBandInk(seed: string): string {
  const c = walletBandColor(seed);
  const m = /hsl\(\d+,\s*\d+%,\s*(\d+)%\)/.exec(c);
  const l = m ? Number(m[1]) : 45;
  return l >= 60 ? "#0a0a0a" : "#ffffff";
}

// The complement (opposite hue) of the band color — used for the stat plaques so they pop
// against the avatar-colored band instead of blending in.
export function walletBandComplement(seed: string): string {
  const c = walletBandColor(seed);
  const m = /hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/.exec(c);
  if (!m) return c;
  const h = (Number(m[1]) + 180) % 360;
  return `hsl(${h},${m[2]}%,${m[3]}%)`;
}
