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

// Terminal-cell width of a string: East Asian wide/fullwidth code points take 2 columns.
// Covers what a chat composer realistically holds (Hangul, CJK, kana, fullwidth forms).
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    w +=
      (c >= 0x1100 && c <= 0x115f) || // Hangul Jamo (leading)
      (c >= 0x2e80 && c <= 0xa4cf) || // CJK radicals … Yi
      (c >= 0xac00 && c <= 0xd7a3) || // Hangul syllables
      (c >= 0xf900 && c <= 0xfaff) || // CJK compat ideographs
      (c >= 0xfe30 && c <= 0xfe4f) || // CJK compat forms
      (c >= 0xff00 && c <= 0xff60) || // fullwidth forms
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x20000 && c <= 0x3fffd) // CJK extension planes
        ? 2
        : 1;
  }
  return w;
}

// Split ONE logical line (no newlines) into display rows of at most `width` cells.
//
// The break is character-level, not word-level, and that is the whole point: a stack-trace
// path or a URL is a single unbreakable "word", so a word wrapper leaves it over-wide.
// Anything wider than the frame is then drawn past the right edge, the terminal itself
// wraps the excess back to column 0, and the tail lands OUTSIDE the card's border — the
// stray "/t" and ".2" fragments in the margin. Breaking mid-token is the only wrap that
// guarantees every row fits, so nothing can ever escape the frame.
//
// Pure partition: rows.join("") === line, so callers can map an index back to a row/cell.
export function wrapHard(line: string, width: number): string[] {
  const w = Math.max(1, width);
  const rows: string[] = [];
  let row = "";
  let rowW = 0;
  for (const ch of line) {
    const cw = displayWidth(ch);
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
