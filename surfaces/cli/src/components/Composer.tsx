import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { colors } from "../theme.js";
import { SLASH_COMMANDS } from "../commands.js";
import { indexFiles, filterFiles } from "../fileIndex.js";
import { readImageFromClipboard, readImageFile, type ImageInput } from "../clipboardImage.js";
import { pinCursor, unpinCursor, layoutBuffer } from "../cursorPin.js";
import { displayWidth, graphemes } from "../format.js";
import { useDelight } from "./DelightProvider.js";

const MENU_CHROME = 2; // the menu block's marginTop + its hint row

// Split the band's row budget between the text buffer and the menu under it.
//
// Exported so the geometry can be checked directly, because it is load-bearing: ink only
// updates incrementally while the live frame is SHORTER than the terminal. Once it isn't,
// ink clears the screen and reprints the entire accumulated scrollback on every render
// (ink.js: `outputHeight >= stdout.rows` → clearTerminal + fullStaticOutput), so one
// keystroke costs one full-transcript repaint — the session appears to scroll by itself.
// A bare "/" matches all 27 slash commands, and rendering them unwindowed was enough to
// cross that line on any normal terminal.
//
// A band under MENU_ROWS_MIN cannot show a menu at all (one buffer row, one item, and the
// menu's own two chrome rows), so on a terminal that short the menu is dropped rather than
// allowed to push the frame over the edge. Tab completion still works without it.
export const MENU_ROWS_MIN = 4;

// Invariant: buf + menu + (menu ? MENU_CHROME : 0) <= maxRows, for every maxRows >= 1.
export function splitBand(maxRows: number, hasMenu: boolean): { buf: number; menu: number } {
  const total = Math.max(1, maxRows);
  if (!hasMenu || total < MENU_ROWS_MIN) return { buf: total, menu: 0 };
  const avail = total - MENU_CHROME; // rows the buffer and menu share
  const buf = Math.max(1, Math.min(3, avail - 1)); // picking a command, not composing prose
  return { buf, menu: Math.max(1, avail - buf) };
}

// Split a laid-out row at a terminal-CELL offset into [before, the cell's char, after],
// so the drawn block cursor lands on the same cell the pin would have parked on.
function splitAtCell(row: string, cell: number): [string, string, string] {
  let head = "";
  let w = 0;
  const chars = graphemes(row);
  let i = 0;
  for (; i < chars.length && w < cell; i++) {
    head += chars[i];
    w += displayWidth(chars[i]);
  }
  return [head, chars[i] ?? " ", chars.slice(i + 1).join("")];
}

// The input box — far past a single line. Supports:
//   • multi-line editing (←/→ within the buffer, paste with newlines, \ + ↵ = newline)
//   • a slash-command menu when the buffer is "/word" (↑/↓ + ↵/⇥ to complete)
//   • @-file mentions: type @query → fuzzy file dropdown (⇥/↵ inserts the path)
// Cursor is a real index so editing happens anywhere in the buffer, not just the end.
export function Composer({
  cwd,
  onSubmit,
  onHelp,
  disabled,
  maxRows,
  history = [],
}: {
  cwd: string;
  onSubmit: (text: string, images?: ImageInput[]) => void;
  // "?" pressed on an empty buffer (the footer advertises "? /HELP"). Only the composer
  // knows the buffer is empty, so the routing decision has to live here.
  onHelp: () => void;
  disabled?: boolean;
  // Rows this band may occupy. Chat owns it: it is the only place that knows what the
  // rest of the frame already costs, so the composer must not guess its own share.
  maxRows: number;
  history?: string[]; // prior user messages, newest last — recalled with ↑/↓
}) {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const { noteTyping } = useDelight();
  const [attached, setAttached] = useState<ImageInput[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [menuIdx, setMenuIdx] = useState(0);
  const [suppress, setSuppress] = useState(false); // esc hides the menu until input changes
  const [histPos, setHistPos] = useState(-1); // -1 = live buffer; 0..n = from newest back
  const [pathQuery, setPathQuery] = useState<string | null>(null);

  useEffect(() => {
    void indexFiles(cwd).then(setFiles);
  }, [cwd]);

  // clear pathQuery when value changes if the trailing word no longer matches it
  useEffect(() => {
    if (pathQuery) {
      const m = /(\S+)$/.exec(value.slice(0, cursor));
      if (!m || !m[1].startsWith(pathQuery)) {
        setPathQuery(null);
      }
    }
  }, [value, cursor, pathQuery]);

  // what menu (if any) is active for the current buffer/cursor.
  const before = value.slice(0, cursor);
  const slash = /^\/(\S*)$/.exec(value);
  const at = /(^|\s)@(\S*)$/.exec(before);
  const menu = useMemo(() => {
    if (suppress) return null;
    if (slash) {
      const q = slash[1].toLowerCase();
      const items = SLASH_COMMANDS.filter((c) => c.name.startsWith(q)).map((c) => ({
        label: `/${c.name}${c.args ? " " + c.args : ""}`,
        hint: c.desc,
        insert: `/${c.name} `,
      }));
      return items.length ? { kind: "slash" as const, items } : null;
    }
    if (at) {
      const items = filterFiles(files, at[2]).map((f) => ({ label: f, hint: "", insert: f }));
      return items.length ? { kind: "file" as const, items } : null;
    }
    if (pathQuery) {
      const m = /(\S+)$/.exec(before);
      if (m) {
        const q = m[1].toLowerCase();
        const matches = files.filter((f) => f.toLowerCase().startsWith(q));
        const items = matches.slice(0, 8).map((f) => ({ label: f, hint: "", insert: f }));
        return items.length ? { kind: "path" as const, items } : null;
      }
    }
    return null;
  }, [slash?.[1], at?.[2], files, suppress, value, pathQuery, before]);

  const sel = menu ? menu.items[Math.min(menuIdx, menu.items.length - 1)] : null;

  function insertAt(s: string) {
    setValue((v) => v.slice(0, cursor) + s + v.slice(cursor));
    setCursor((c) => c + s.length);
    setSuppress(false);
    setHistPos(-1); // editing leaves history-recall mode
  }

  function complete() {
    if (!menu || !sel) return;
    if (menu.kind === "slash") {
      setValue(sel.insert);
      setCursor(sel.insert.length);
    } else if (menu.kind === "file") {
      // replace the trailing @query with @path + space
      const m = /(^|\s)@(\S*)$/.exec(before)!;
      const start = before.length - m[2].length; // position right after '@'
      const next = value.slice(0, start) + sel.insert + " " + value.slice(cursor);
      setValue(next);
      setCursor(start + sel.insert.length + 1);
    } else if (menu.kind === "path") {
      // replace the trailing word with path + space
      const m = /(\S+)$/.exec(before)!;
      const start = before.length - m[1].length;
      const next = value.slice(0, start) + sel.insert + " " + value.slice(cursor);
      setValue(next);
      setCursor(start + sel.insert.length + 1);
      setPathQuery(null);
    }
    setMenuIdx(0);
  }

  async function submit() {
    const text = value.trim();
    const imgs = [...attached];
    setValue("");
    setCursor(0);
    setMenuIdx(0);
    setHistPos(-1);
    setAttached([]);
    // if the buffer is exactly an image file path, attach it instead of sending as text
    if (!imgs.length && text && !/\s/.test(text)) {
      const fromPath = await readImageFile(text);
      if (fromPath) {
        onSubmit("", [fromPath]);
        return;
      }
    }
    onSubmit(text, imgs.length ? imgs : undefined);
  }

  useInput(
    (input, key) => {
      noteTyping(); // pause animations for a beat — repaints flicker IME composition
      if (menu && (key.upArrow || key.downArrow)) {
        setMenuIdx((i) => {
          const n = menu.items.length;
          return key.upArrow ? (i - 1 + n) % n : (i + 1) % n;
        });
        return;
      }
      // no menu → ↑/↓ recalls prior messages (newest first).
      if (!menu && (key.upArrow || key.downArrow) && history.length) {
        let pos = histPos;
        if (key.upArrow) pos = Math.min(history.length - 1, pos + 1);
        else pos = pos - 1;
        setHistPos(pos);
        const recalled = pos < 0 ? "" : history[history.length - 1 - pos];
        setValue(recalled);
        setCursor(recalled.length);
        return;
      }
      if (key.tab) {
        if (menu) {
          complete();
          return;
        }
        const m = /(\S+)$/.exec(before);
        if (m) {
          setPathQuery(m[1]);
          setMenuIdx(0);
          setSuppress(false);
          return;
        }
      }
      if (key.escape) return setSuppress(true);

      // readline-style editing
      if (key.ctrl && input === "a") return setCursor(0); // line start
      if (key.ctrl && input === "e") return setCursor(value.length); // line end
      if (key.ctrl && input === "u") {
        setValue((v) => v.slice(cursor)); // kill to start
        setCursor(0);
        setHistPos(-1);
        return;
      }
      if (key.ctrl && input === "k") {
        setValue((v) => v.slice(0, cursor)); // kill to end
        return;
      }
      if (key.ctrl && input === "w") {
        // delete the word before the cursor (skip trailing spaces, then the word)
        let i = cursor;
        while (i > 0 && /\s/.test(value[i - 1])) i--;
        while (i > 0 && !/\s/.test(value[i - 1])) i--;
        setValue(value.slice(0, i) + value.slice(cursor));
        setCursor(i);
        setHistPos(-1);
        return;
      }
      // Ctrl+V → try to grab an image off the OS clipboard; fall through to text paste if none
      if (key.ctrl && input === "v") {
        void readImageFromClipboard().then((img) => {
          if (img) setAttached((a) => [...a, img]);
          // if no image, Ctrl+V in a terminal usually inserts ^V — intentionally do nothing;
          // regular text pasting flows through the terminal emulator as normal stdin input.
        });
        return;
      }
      if (key.return) {
        if (menu && sel) {
          // if the full command is already typed, RUN it; otherwise complete the menu.
          if (menu.kind === "slash" && sel.insert.trim() === value.trim()) { void submit(); return; }
          return complete();
        }
        if (value[cursor - 1] === "\\") {
          // \ + ↵ → newline
          setValue((v) => v.slice(0, cursor - 1) + "\n" + v.slice(cursor));
          return;
        }
        void submit();
        return;
      }
      if (key.backspace || key.delete) {
        // if buffer is empty and there are attached images, remove the last one
        if (value.length === 0 && attached.length > 0) {
          setAttached((a) => a.slice(0, -1));
          return;
        }
        if (cursor > 0) {
          setValue((v) => v.slice(0, cursor - 1) + v.slice(cursor));
          setCursor((c) => c - 1);
          setSuppress(false);
        }
        return;
      }
      if (key.leftArrow) return setCursor((c) => Math.max(0, c - 1));
      if (key.rightArrow) return setCursor((c) => Math.min(value.length, c + 1));
      // "?" on an EMPTY composer opens help, keeping the footer's "? /HELP" promise.
      // With anything typed (or an image awaiting a caption), "?" is just a character.
      if (input === "?" && value.length === 0 && attached.length === 0) return onHelp();
      if (input && !key.ctrl && !key.meta) insertAt(input); // printable / paste (may include \n)
    },
    { isActive: !disabled },
  );

  const empty = value.length === 0;

  // We lay the buffer out into display rows ourselves rather than letting ink word-wrap
  // it, so the caret's screen cell is always known — including once the text spills onto
  // a second row. Width: the frame's paddingX(1) on each side, minus the "❯ " prompt.
  const contentW = Math.max(1, (process.stdout.columns || 80) - 4);
  const { rows: allRows, caretRow: bufCaretRow, caretCol } = layoutBuffer(value, cursor, contentW);

  // `maxRows` covers this WHOLE band — the buffer AND the menu under it — and both are
  // windowed to stay inside it (see splitBand for why that matters).
  const { buf: bufBudget, menu: menuBudget } = splitBand(maxRows, Boolean(menu));
  const showMenu = menuBudget > 0;

  // Scroll a window over the buffer, keeping the caret's row in view.
  const winStart =
    allRows.length > bufBudget
      ? Math.min(Math.max(0, bufCaretRow - bufBudget + 1), allRows.length - bufBudget)
      : 0;
  const bufRows = allRows.slice(winStart, winStart + bufBudget);
  const caretRow = bufCaretRow - winStart;

  // …and the same over the menu, keeping the highlighted entry in view.
  const menuItems = menu?.items ?? [];
  const menuSel = menuItems.length ? Math.min(menuIdx, menuItems.length - 1) : 0;
  const menuStart =
    menuItems.length > menuBudget
      ? Math.min(Math.max(0, menuSel - menuBudget + 1), menuItems.length - menuBudget)
      : 0;
  const menuWindow = menuItems.slice(menuStart, menuStart + menuBudget);
  const menuHidden = menuItems.length - menuWindow.length;

  // While pinned, the REAL terminal cursor IS the caret, so no fake inverse block is
  // drawn — two cursors would double every glyph the IME is composing. A disabled
  // composer isn't taking input, so it shows no caret at all.
  //
  // The pin drives the terminal with raw save/restore-cursor escapes, so it only runs on
  // a real TTY (see canPin) — and a few terminals/multiplexers swallow those anyway. If
  // the pin is not running there must still be a caret on screen or you are typing blind,
  // so those cases fall back to the drawn block cursor. AGENTNET_NO_CURSOR_PIN=1 forces
  // that fallback (cost: IME preedit shows below the frame while composing).
  const pinned =
    !disabled && !process.env.AGENTNET_NO_CURSOR_PIN && Boolean(process.stdout.isTTY);

  // Park the real cursor on the caret after every frame, so IME composition
  // (Hangul/CJK preedit) renders inline instead of below the UI. Row math mirrors what
  // renders below the CARET's row — the rest of the wrapped buffer, the menu block here,
  // plus the section rule + footer row Chat draws under us.
  useEffect(() => {
    if (!pinned) {
      unpinCursor();
      return;
    }
    const rowsBelowCaret = bufRows.length - 1 - caretRow;
    const menuLines = showMenu ? menuWindow.length + MENU_CHROME : 0; // marginTop + items + hint
    const chromeBelow = 2; // Chat: rule line + footer row
    // caret column: root paddingX(1) + "❯ "(2) + cells into the row, 1-based.
    pinCursor(rowsBelowCaret + menuLines + chromeBelow + 1, 4 + caretCol); // +1: ink's resting line
  });
  useEffect(() => () => unpinCursor(), []);

  return (
    <Box flexDirection="column">
      {attached.length > 0 && (
        <Box marginBottom={0}>
          {attached.map((img, i) => (
            <Text key={i} color={colors.iqCyan}>[{img.name ?? "image"}] </Text>
          ))}
          <Text dimColor>(↵ sends · ⌫ removes last)</Text>
        </Box>
      )}
      {/* the input row — a full-width band between the chat frame's section rules
          (Chat draws the rules); just the green prompt and the buffer here. */}
      <Box>
        <Text color={colors.iqCyan}>❯ </Text>
        {empty && !attached.length ? (
          <Text dimColor wrap="truncate-end">message · / for commands · @ for files · Ctrl+V image</Text>
        ) : (
          // one <Text> per display row: the rows are pre-wrapped to contentW, so ink
          // renders them verbatim and the caret's row/column stay exactly as measured.
          // Unpinned, the caret's cell is drawn as an inverse block instead.
          <Box flexDirection="column">
            {bufRows.map((r, i) => {
              if (pinned || i !== caretRow) {
                return <Text key={i} wrap="truncate-end">{r === "" ? " " : r}</Text>;
              }
              const [head, curCh, tail] = splitAtCell(r, caretCol);
              return (
                <Text key={i} wrap="truncate-end">
                  {head}
                  <Text inverse>{curCh}</Text>
                  {tail}
                </Text>
              );
            })}
          </Box>
        )}
      </Box>

      {showMenu ? (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          {menuWindow.map((it, i) => {
            const on = menuStart + i === menuSel;
            return (
              <Box key={it.label}>
                <Text color={on ? colors.iqCyan : undefined}>{on ? "› " : "  "}</Text>
                <Text color={on ? colors.iqCyan : undefined} bold={on} wrap="truncate-end">
                  {it.label}
                </Text>
                {it.hint ? <Text dimColor wrap="truncate-end"> · {it.hint}</Text> : null}
              </Box>
            );
          })}
          <Text dimColor>
            ↑/↓ · ⇥/↵ select · esc hide
            {menuHidden > 0 ? ` · +${menuHidden} more` : ""}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
