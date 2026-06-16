import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { colors } from "../theme.js";
import { SLASH_COMMANDS } from "../commands.js";
import { indexFiles, filterFiles } from "../fileIndex.js";

// The input box — far past a single line. Supports:
//   • multi-line editing (←/→ within the buffer, paste with newlines, \ + ↵ = newline)
//   • a slash-command menu when the buffer is "/word" (↑/↓ + ↵/⇥ to complete)
//   • @-file mentions: type @query → fuzzy file dropdown (⇥/↵ inserts the path)
// Cursor is a real index so editing happens anywhere in the buffer, not just the end.
export function Composer({
  cwd,
  onSubmit,
  disabled,
  history = [],
}: {
  cwd: string;
  onSubmit: (text: string) => void;
  disabled?: boolean;
  history?: string[]; // prior user messages, newest last — recalled with ↑/↓
}) {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
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

  function submit() {
    const text = value;
    setValue("");
    setCursor(0);
    setMenuIdx(0);
    setHistPos(-1);
    onSubmit(text);
  }

  useInput(
    (input, key) => {
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
      if (key.return) {
        if (menu && sel) {
          // if the full command is already typed, RUN it; otherwise complete the menu.
          if (menu.kind === "slash" && sel.insert.trim() === value.trim()) return submit();
          return complete();
        }
        if (value[cursor - 1] === "\\") {
          // \ + ↵ → newline
          setValue((v) => v.slice(0, cursor - 1) + "\n" + v.slice(cursor));
          return;
        }
        return submit();
      }
      if (key.backspace || key.delete) {
        if (cursor > 0) {
          setValue((v) => v.slice(0, cursor - 1) + v.slice(cursor));
          setCursor((c) => c - 1);
          setSuppress(false);
        }
        return;
      }
      if (key.leftArrow) return setCursor((c) => Math.max(0, c - 1));
      if (key.rightArrow) return setCursor((c) => Math.min(value.length, c + 1));
      if (input && !key.ctrl && !key.meta) insertAt(input); // printable / paste (may include \n)
    },
    { isActive: !disabled },
  );

  // render buffer with a block cursor.
  const head = value.slice(0, cursor);
  const curCh = value[cursor] ?? " ";
  const tail = value.slice(cursor + 1);
  const empty = value.length === 0;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={colors.iqCyan}>❯ </Text>
        {empty ? (
          <Text dimColor>message · / for commands · @ for files</Text>
        ) : (
          <Text>
            {head}
            <Text inverse>{curCh}</Text>
            {tail}
          </Text>
        )}
      </Box>

      {menu ? (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          {menu.items.map((it, i) => {
            const on = i === Math.min(menuIdx, menu.items.length - 1);
            return (
              <Box key={it.label}>
                <Text color={on ? colors.iqCyan : undefined}>{on ? "› " : "  "}</Text>
                <Text color={on ? colors.iqCyan : undefined} bold={on}>
                  {it.label}
                </Text>
                {it.hint ? <Text dimColor> · {it.hint}</Text> : null}
              </Box>
            );
          })}
          <Text dimColor>↑/↓ · ⇥/↵ select · esc hide</Text>
        </Box>
      ) : null}
    </Box>
  );
}
