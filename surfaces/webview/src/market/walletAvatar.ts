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

export function walletAvatarSvg(seed: string): string {
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
