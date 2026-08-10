// Inline-IME support. Ink hides the real terminal cursor and leaves it parked below the
// frame, so Hangul/CJK composition text (drawn by the emulator AT the cursor) pops up
// under the UI and flickers while composing. Fix: keep the real cursor parked on the
// composer's caret. Ink's erase math is relative to the cursor position it left, so the
// stdout wrapper below restores that position right before EVERY write and re-applies
// the pin right after — ink's throttled/trailing renders included, which is why this
// can't be a one-shot move from a React effect.
let active = false; // a pin is desired and currently applied
let up = 0; // rows above ink's resting position
let col = 1; // 1-based target column
let installed = false;
let raw: (chunk: string) => boolean;

// The pin only ever drives a REAL terminal. Piped/redirected/captured output (a harness
// collecting the CLI's stdout, `| tee`, a CI log) must receive plain text: raw
// save/restore-cursor escapes in a captured stream get replayed into whatever terminal
// later prints that log and scramble it.
function canPin(): boolean {
  return Boolean(process.stdout.isTTY);
}

function pinSeq(): string {
  // DECSC at ink's resting spot, then move to the caret and show the cursor.
  // ESC[0A still moves up one row on most emulators, so omit the move when up is 0.
  const upSeq = up > 0 ? `\u001b[${up}A` : "";
  return `\u001b7${upSeq}\u001b[${col}G\u001b[?25h`;
}

function install() {
  if (installed) return;
  installed = true;
  const original = process.stdout.write.bind(process.stdout);
  raw = (chunk: string) => original(chunk);
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (!active) return (original as (...a: unknown[]) => boolean)(chunk, ...rest);
    raw("\u001b8"); // DECRC — back to where ink expects the cursor
    const ok = (original as (...a: unknown[]) => boolean)(chunk, ...rest);
    raw(pinSeq()); // re-park on the caret after the frame lands
    return ok;
  }) as typeof process.stdout.write;
}

export function pinCursor(rowsUp: number, targetCol: number) {
  if (!canPin()) return;
  install();
  if (active) raw("\u001b8"); // undo the previous pin before measuring a new one
  up = rowsUp;
  col = targetCol;
  active = true;
  raw(pinSeq());
}

// Return the cursor to ink's resting position and hide it again (ink's default state).
export function unpinCursor() {
  if (!active) return;
  active = false;
  raw("\u001b8\u001b[?25l");
}

// Where the caret actually sits on screen once the buffer is laid out.
export interface BufferLayout {
  rows: string[]; // the display rows the composer renders, one per screen line
  caretRow: number; // 0-based row the caret is on
  caretCol: number; // 0-based terminal-cell offset within that row
}

// Lay a buffer out into the exact display rows the composer will render: explicit
// newlines first, then a HARD wrap at `width` cells. Hard (character-level) rather than
// word-level on purpose — ink's default word wrap makes the caret's screen position
// unknowable, which is why the pin used to give up the moment a line wrapped and left
// Hangul/CJK composition stranded below the frame. Wrapping here means we render the
// rows ourselves and always know which cell the caret is on.
export function layoutBuffer(value: string, cursor: number, width: number): BufferLayout {
  const w = Math.max(1, width);
  const rows: string[] = [];
  let row = "";
  let rowW = 0;
  let caretRow = 0;
  let caretCol = 0;
  let found = false;
  let idx = 0;
  const mark = () => {
    caretRow = rows.length;
    caretCol = rowW;
    found = true;
  };
  for (const ch of value) {
    if (ch === "\n") {
      if (idx === cursor) mark(); // caret on the newline = end of the row it terminates
      rows.push(row);
      row = "";
      rowW = 0;
      idx += 1;
      continue;
    }
    const cw = displayWidth(ch);
    if (rowW + cw > w) {
      rows.push(row);
      row = "";
      rowW = 0;
    }
    if (idx === cursor) mark(); // mark AFTER wrapping, so the caret follows the char
    row += ch;
    rowW += cw;
    idx += ch.length;
  }
  if (idx === cursor) mark(); // caret at end of buffer
  rows.push(row);
  if (!found) {
    caretRow = rows.length - 1;
    caretCol = rowW;
  }
  return { rows, caretRow, caretCol };
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
