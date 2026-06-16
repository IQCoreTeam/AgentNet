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

// pad every line to the block's widest line so a shaded diff renders as a clean rectangle.
export function padBlock(lines: string[]): { lines: string[]; width: number } {
  const width = Math.min(100, Math.max(0, ...lines.map((l) => l.length)));
  return { lines: lines.map((l) => (l.length > width ? l.slice(0, width) : l.padEnd(width))), width };
}
