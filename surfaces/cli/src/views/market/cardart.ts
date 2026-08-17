// Mint-derived card art, design 08/24's "THE CARD IS THE PRODUCT": every card leads
// with drawn pixels. In a terminal the CLI ships the deterministic layer design 10
// names for no-image-protocol environments: the mint hash seeds a small SYMMETRIC
// pixel field rendered as ▀ half-blocks (one cell = two vertical pixels via fg/bg),
// in a duotone ramp of the mint's own hue so the art sits inside the palette instead
// of fighting it. Same mint, same art, every open, offline.
import { fnv1a, hslHex } from "./avatar.js";

// mulberry32: tiny deterministic PRNG so the field is reproducible from the seed.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ArtCell {
  fg: string; // upper pixel of the ▀ cell
  bg: string; // lower pixel
}

// `cols` x `rows` CELLS (so cols x rows*2 pixels). The field is mirrored around its
// vertical axis, the same symmetry call as the wallet face: mirroring is what makes
// hash noise read as a deliberate emblem. Mostly-ink ground with sparse bright hits
// keeps it a quiet banner, not a rainbow block.
export function mintArt(mint: string, cols: number, rows: number): ArtCell[][] {
  const h = fnv1a(mint + "/art");
  const hue = h % 360;
  const ink = "#0a0a0b";
  const ramp = [ink, hslHex(hue, 45, 20), hslHex(hue, 55, 40), hslHex(hue, 62, 62)];
  const rand = mulberry32(h);
  const pick = () => {
    const r = rand();
    return r < 0.4 ? 0 : r < 0.65 ? 1 : r < 0.87 ? 2 : 3;
  };
  const pxRows = rows * 2;
  const half = Math.ceil(cols / 2);
  const px: number[][] = [];
  for (let y = 0; y < pxRows; y++) {
    const left = Array.from({ length: half }, pick);
    const row = left.concat(left.slice(0, cols - half).reverse());
    px.push(row);
  }
  const cells: ArtCell[][] = [];
  for (let r = 0; r < rows; r++) {
    cells.push(
      Array.from({ length: cols }, (_, x) => ({ fg: ramp[px[r * 2][x]], bg: ramp[px[r * 2 + 1][x]] })),
    );
  }
  return cells;
}
