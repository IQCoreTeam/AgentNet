// Wallet-derived identity, design tab 20's //AVATAR_ band: "SAME WALLET, SAME FACE,
// EVERYWHERE." A pure hash of the wallet address picks a hue and a tiny mirrored ░▒▓█
// cell strip, so an agent is recognizable at a glance on every screen that shows a
// wallet: no storage, no network, and deterministic forever. One wallet, one face.

// FNV-1a 32-bit: tiny, dependency-free, well distributed for short strings.
// Exported: cardart.ts seeds the mint art from the same hash primitive.
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// hsl -> hex with saturation/lightness pinned where EVERY hue stays readable on the
// near-black ground: dark hues would vanish into the ink, neon would fight the bone.
// Exported: cardart.ts builds its duotone ramp from the same converter.
export function hslHex(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = lN - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// The wallet's hue, spread across the whole wheel so neighboring agents differ.
export function walletColor(wallet: string): string {
  return hslHex(fnv1a(wallet) % 360, 62, 62);
}

const CELLS = ["░", "▒", "▓", "█"] as const;

// 3-cell mirrored strip (a b a): the symmetry is what makes it read as a face rather
// than noise. 16 patterns x the hue wheel keeps collisions rare at a glance; the hash
// is salted so the pattern and the hue vary independently.
export function walletFace(wallet: string): string {
  const h = fnv1a(wallet + "/face");
  const a = CELLS[h & 3];
  const b = CELLS[(h >> 2) & 3];
  return `${a}${b}${a}`;
}
