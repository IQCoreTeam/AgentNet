import { displayWidth, wrapHard } from "./format.js";

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

// Synchronized output (DEC private mode 2026). Between BSU and ESU the terminal holds the
// frame back and swaps it in one go, so a repaint can never be seen half-drawn. Without it
// every ink render is: erase N lines, then draw N lines - and the gap between those two is
// exactly the flicker, worst on a slow pipe like tmux or a remote shell. Terminals that do
// not know the mode ignore the sequence, which is why this needs no capability probe;
// AGENTNET_NO_SYNC=1 turns it off for anything that mishandles it.
const BSU = "\u001b[?2026h";
const ESU = "\u001b[?2026l";
const syncOn = () => Boolean(process.stdout.isTTY) && !process.env.AGENTNET_NO_SYNC;

// One stdout filter serves both jobs, because they have to compose in a fixed order:
// restore ink's cursor, let ink write, re-pin the caret - and the whole thing wrapped in
// one synchronized frame, emitted as a SINGLE write so the terminal sees it atomically.
function install() {
  if (installed) return;
  installed = true;
  const original = process.stdout.write.bind(process.stdout);
  raw = (chunk: string) => original(chunk);
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    const call = original as (...a: unknown[]) => boolean;
    // Only strings can be spliced; a Buffer write goes straight through untouched.
    if (typeof chunk !== "string" || (!active && !syncOn())) return call(chunk, ...rest);
    const body = active ? `\u001b8${chunk}${pinSeq()}` : chunk;
    return call(syncOn() ? `${BSU}${body}${ESU}` : body, ...rest);
  }) as typeof process.stdout.write;
}

// Called once at boot so frames are synchronized even before the composer pins anything.
export function installStdoutFilter() {
  if (syncOn()) install();
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
  const rows: string[] = [];
  let caretRow = 0;
  let caretCol = 0;
  let placed = false;
  let idx = 0; // index into `value` of the first character of the row about to be pushed

  const lines = value.split("\n");
  for (const line of lines) {
    const wrapped = wrapHard(line, width);
    for (let ri = 0; ri < wrapped.length; ri++) {
      const r = wrapped[ri];
      const end = idx + r.length;
      // A caret sitting exactly at a mid-line wrap boundary belongs to the NEXT row (it
      // follows the character that moved down); at the end of the LAST row of a logical
      // line it stays put — that is the "caret on the newline" case.
      const lastRowOfLine = ri === wrapped.length - 1;
      if (!placed && cursor >= idx && (cursor < end || (cursor === end && lastRowOfLine))) {
        caretRow = rows.length;
        caretCol = displayWidth(r.slice(0, cursor - idx));
        placed = true;
      }
      rows.push(r);
      idx = end;
    }
    idx += 1; // the "\n" that separated this line from the next
  }

  if (!placed) {
    caretRow = rows.length - 1;
    caretCol = displayWidth(rows[caretRow]);
  }
  return { rows, caretRow, caretCol };
}
