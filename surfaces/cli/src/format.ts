// Small text helpers for rendering tool output cleanly.

// Strip ANSI escape sequences (color codes from pytest/jest/ls --color, cursor moves) so a
// command's colored output doesn't garble our card or break the border. Covers CSI
// (colors/cursor), OSC hyperlinks, and charset-select escapes.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-Za-z]/g;
export function stripAnsi(s: string): string {
  return s.replace(ANSI, "");
}

// Clamp text to `max` lines; return the visible head + how many were hidden, so the card
// can show a "+N more lines" fold instead of a wall of text.
export function clampLines(s: string, max: number): { shown: string; hidden: number } {
  const lines = s.replace(/\s+$/, "").split("\n");
  if (lines.length <= max) return { shown: lines.join("\n"), hidden: 0 };
  return { shown: lines.slice(0, max).join("\n"), hidden: lines.length - max };
}

export function lineCount(s: string): number {
  const t = s.replace(/\s+$/, "");
  return t === "" ? 0 : t.split("\n").length;
}

// Grapheme clusters are the unit a terminal draws (one flag, one joined family, one
// accented letter = one glyph), so measuring and slicing walk clusters, never code
// units. One shared segmenter; grapheme granularity is locale independent.
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function graphemes(s: string): string[] {
  const out: string[] = [];
  for (const g of SEGMENTER.segment(s)) out.push(g.segment);
  return out;
}

// A code point that renders 2 cells on its own: the East Asian wide/fullwidth ranges,
// emoji pictographs, and the emoji-presentation singletons scattered below U+1F300
// (⌚ ⏰ ✅ ✨ ❌ ⚡ ⭐ …, East Asian Wide since Unicode 9).
function wideCodePoint(c: number): boolean {
  return (
    (c >= 0x1100 && c <= 0x115f) || // Hangul Jamo (leading)
    (c >= 0x231a && c <= 0x231b) ||
    (c >= 0x23e9 && c <= 0x23ec) ||
    c === 0x23f0 ||
    c === 0x23f3 ||
    (c >= 0x25fd && c <= 0x25fe) ||
    (c >= 0x2614 && c <= 0x2615) ||
    (c >= 0x2648 && c <= 0x2653) ||
    c === 0x267f ||
    c === 0x2693 ||
    c === 0x26a1 ||
    (c >= 0x26aa && c <= 0x26ab) ||
    (c >= 0x26bd && c <= 0x26be) ||
    (c >= 0x26c4 && c <= 0x26c5) ||
    c === 0x26ce ||
    c === 0x26d4 ||
    c === 0x26ea ||
    (c >= 0x26f2 && c <= 0x26f3) ||
    c === 0x26f5 ||
    c === 0x26fa ||
    c === 0x26fd ||
    c === 0x2705 ||
    (c >= 0x270a && c <= 0x270b) ||
    c === 0x2728 ||
    c === 0x274c ||
    c === 0x274e ||
    (c >= 0x2753 && c <= 0x2755) ||
    c === 0x2757 ||
    (c >= 0x2795 && c <= 0x2797) ||
    c === 0x27b0 ||
    c === 0x27bf ||
    (c >= 0x2b1b && c <= 0x2b1c) ||
    c === 0x2b50 ||
    c === 0x2b55 ||
    (c >= 0x2e80 && c <= 0xa4cf) || // CJK radicals … Yi
    (c >= 0xa960 && c <= 0xa97c) || // Hangul Jamo Extended-A
    (c >= 0xac00 && c <= 0xd7a3) || // Hangul syllables
    (c >= 0xf900 && c <= 0xfaff) || // CJK compat ideographs
    (c >= 0xfe10 && c <= 0xfe19) || // vertical forms
    (c >= 0xfe30 && c <= 0xfe4f) || // CJK compat forms
    (c >= 0xfe50 && c <= 0xfe66) || // small form variants
    (c >= 0xfe68 && c <= 0xfe6b) ||
    (c >= 0xff00 && c <= 0xff60) || // fullwidth forms
    (c >= 0xffe0 && c <= 0xffe6) ||
    c === 0x1f004 ||
    c === 0x1f0cf ||
    c === 0x1f18e ||
    (c >= 0x1f191 && c <= 0x1f19a) ||
    (c >= 0x1f200 && c <= 0x1f265) || // squared CJK (🈁 🈚 🉐 …)
    (c >= 0x1f300 && c <= 0x1faff) || // emoji pictographs through Extended-A
    (c >= 0x20000 && c <= 0x3fffd) // CJK extension planes
  );
}

// Cells ONE grapheme cluster occupies. 2 when it carries a wide code point, a regional
// indicator (flags), or a presentation mark on a visible base (☂ -> ☂️, # -> #⃣); 0
// when it is only invisible marks (a bare joiner or selector); 1 otherwise. Stateless
// per cluster, so summing cluster widths always equals the whole string's width.
function clusterWidth(g: string): number {
  let selector = false;
  let visible = false;
  for (const ch of g) {
    const c = ch.codePointAt(0)!;
    if (wideCodePoint(c) || (c >= 0x1f1e6 && c <= 0x1f1ff)) return 2;
    if (c === 0xfe0e || c === 0xfe0f || c === 0x20e3) {
      selector = true; // variation selectors and the enclosing keycap
      continue;
    }
    if (c === 0x200b || c === 0x200d || c === 0x2060 || (c >= 0x0300 && c <= 0x036f))
      continue; // joiners, zero widths, combining marks
    visible = true;
  }
  // Ink's measurer widens selector-carrying pictographs in both directions (FE0E and
  // FE0F); rounding every selector-on-base up to 2 can only wrap a hair early, never
  // overflow. Bare text-presentation pictographs (⚠ © ™ typed without a selector) stay
  // 1 on purpose: terminals advance them narrow even where ink budgets 2.
  if (selector && visible) return 2;
  return visible ? 1 : 0;
}

const ASCII_ONLY = /^[\x20-\x7e]*$/;

// Terminal-cell width of a string, cluster by cluster: East Asian wide/fullwidth code
// points and emoji take 2 columns, and a composed sequence (family, flag, skin tone,
// accent) counts as the one glyph a terminal draws, the way ink's own measurer does.
// Covers what a chat composer realistically holds (Hangul, CJK, kana, fullwidth forms,
// emoji). Printable ascii, the overwhelming case for tool output, skips segmentation.
export function displayWidth(s: string): number {
  if (ASCII_ONLY.test(s)) return s.length;
  let w = 0;
  for (const g of SEGMENTER.segment(s)) w += clusterWidth(g.segment);
  return w;
}

// Split ONE logical line (no newlines) into display rows of at most `width` cells.
//
// The break is cluster-level, not word-level, and that is the whole point: a stack-trace
// path or a URL is a single unbreakable "word", so a word wrapper leaves it over-wide.
// Anything wider than the frame is then drawn past the right edge, the terminal itself
// wraps the excess back to column 0, and the tail lands OUTSIDE the card's border — the
// stray "/t" and ".2" fragments in the margin. Breaking mid-token is the only wrap that
// guarantees every row fits, so nothing can ever escape the frame.
//
// Pure partition: rows.join("") === line, so callers can map an index back to a row/cell.
export function wrapHard(line: string, width: number): string[] {
  const w = Math.max(1, width);
  if (ASCII_ONLY.test(line)) {
    // every cell is one column: plain slicing, no segmentation
    if (line.length <= w) return [line];
    const rows: string[] = [];
    for (let i = 0; i < line.length; i += w) rows.push(line.slice(i, i + w));
    return rows;
  }
  const rows: string[] = [];
  let row = "";
  let rowW = 0;
  for (const g of SEGMENTER.segment(line)) {
    const ch = g.segment;
    const cw = clusterWidth(ch);
    // rowW > 0 guard: a single char wider than the row still gets its own row rather
    // than an empty one before it.
    if (rowW > 0 && rowW + cw > w) {
      rows.push(row);
      row = "";
      rowW = 0;
    }
    row += ch;
    rowW += cw;
  }
  rows.push(row);
  return rows;
}

// Hard-wrap a whole block, honouring its explicit newlines first.
export function wrapBlock(text: string, width: number): string[] {
  return text.split("\n").flatMap((l) => wrapHard(l, width));
}

// Pad to an exact cell count (display-width aware, so Hangul/CJK don't overshoot).
// Used to square off the shaded diff bands into clean rectangles.
export function padCells(s: string, width: number): string {
  const pad = width - displayWidth(s);
  return pad > 0 ? s + " ".repeat(pad) : s;
}

// Fit to `width` cells keeping the TAIL: the part that identifies a path (its file name)
// or the newest characters of typed input survives, behind a leading ellipsis.
export function truncateStart(s: string, width: number): string {
  if (displayWidth(s) <= width) return s;
  let tail = s;
  while (tail.length > 1 && displayWidth(`…${tail}`) > width) tail = tail.slice(1);
  return `…${tail}`;
}
