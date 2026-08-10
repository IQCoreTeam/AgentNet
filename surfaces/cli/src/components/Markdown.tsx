import React from "react";
import { Box, Text } from "ink";
import { highlight } from "cli-highlight";
import { colors } from "../theme.js";
import { displayWidth, padCells, wrapHard } from "../format.js";

// A small, dependency-light markdown renderer for the terminal. Handles the blocks that
// actually show up in assistant replies: headings, bullet/numbered lists, fenced code
// (syntax-highlighted), tables, rules, blockquotes, and inline **bold** / *italic* /
// `code` / [links]. Not a full CommonMark engine — just the 90% that matters, rendered
// as Ink nodes.
//
// Everything here is width-aware. Assistant text is full of unbreakable tokens (paths,
// URLs, hashes); ink can only break on spaces, so an over-long token is drawn past the
// right edge and the terminal wraps the tail back to column 0, outside the frame.

// ── inline spans ───────────────────────────────────────────────────────────────
// Order matters: a code span or a link wins over emphasis, so `node_modules/...` keeps its
// underscores instead of being read as italics. The _ forms also require a word boundary —
// without it any path with two underscores (node_modules/.pnpm/... /node_modules) matched
// as emphasis and the underscores were silently deleted from the rendered text.
const INLINE =
  /(`[^`]+`|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|(?<!\w)__[^_]+__(?!\w)|\*[^*]+\*|(?<!\w)_[^_]+_(?!\w))/g;

function Inline({ text }: { text: string }) {
  const parts = text.split(INLINE).filter((p) => p !== "");
  return (
    <>
      {parts.map((p, i) => {
        if ((p.startsWith("**") && p.endsWith("**")) || (p.startsWith("__") && p.endsWith("__")))
          return <Text key={i} bold>{p.slice(2, -2)}</Text>;
        if ((p.startsWith("*") && p.endsWith("*")) || (p.startsWith("_") && p.endsWith("_")))
          return <Text key={i} italic>{p.slice(1, -1)}</Text>;
        if (p.startsWith("`") && p.endsWith("`"))
          return <Text key={i} color={colors.iqCyan}>{p.slice(1, -1)}</Text>;
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p);
        if (link) return <Text key={i} color={colors.iqViolet} underline>{link[1]}</Text>;
        return <Text key={i}>{p}</Text>;
      })}
    </>
  );
}

// Soft-wrap on spaces where possible, hard-break any token that still doesn't fit. Inline
// markers are re-parsed per row, so **bold** that survives a break still renders bold.
function wrapProse(text: string, width: number): string[] {
  const out: string[] = [];
  let row = "";
  for (const word of text.split(/(\s+)/)) {
    if (word === "") continue;
    if (displayWidth(row + word) <= width) {
      row += word;
      continue;
    }
    if (row.trim() !== "") {
      out.push(row.replace(/\s+$/, ""));
      row = "";
    }
    if (/^\s+$/.test(word)) continue;
    if (displayWidth(word) <= width) {
      row = word;
    } else {
      const pieces = wrapHard(word, width);
      out.push(...pieces.slice(0, -1));
      row = pieces[pieces.length - 1];
    }
  }
  if (row.trim() !== "") out.push(row.replace(/\s+$/, ""));
  return out.length ? out : [""];
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isTableSep = (l: string) => /^\s*\|[\s:|-]+\|\s*$/.test(l) && l.includes("-");
const splitRow = (l: string) =>
  l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

// A pipe table, laid out as real aligned columns and budgeted to the available width.
function Table({ rows, width }: { rows: string[][]; width: number }) {
  const cols = Math.max(...rows.map((r) => r.length));
  const grid = rows.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? ""));
  // natural width per column, then shrink the widest ones until the table fits.
  const widths = Array.from({ length: cols }, (_, i) =>
    Math.max(...grid.map((r) => displayWidth(r[i]))),
  );
  const chrome = 3 * (cols - 1); // " | " between columns
  let over = widths.reduce((a, b) => a + b, 0) + chrome - width;
  while (over > 0) {
    const widest = widths.indexOf(Math.max(...widths));
    if (widths[widest] <= 3) break;
    widths[widest] -= 1;
    over -= 1;
  }
  const cell = (s: string, w: number) =>
    displayWidth(s) > w ? padCells(wrapHard(s, Math.max(1, w - 1))[0] + "…", w) : padCells(s, w);

  const [head, ...body] = grid;
  return (
    <Box flexDirection="column">
      <Text bold color={colors.bone}>{head.map((c, i) => cell(c, widths[i])).join(" │ ")}</Text>
      <Text color={colors.dim}>{widths.map((w) => "─".repeat(w)).join("─┼─")}</Text>
      {body.map((r, i) => (
        <Text key={i}>{r.map((c, j) => cell(c, widths[j])).join(" │ ")}</Text>
      ))}
    </Box>
  );
}

// ── block parse ────────────────────────────────────────────────────────────────
export function Markdown({ text, width }: { text: string; width: number }) {
  const w = Math.max(20, width);
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    const fence = /^```(\w*)/.exec(line.trim());
    if (fence) {
      const lang = fence[1] || undefined;
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) buf.push(lines[i++]);
      i++; // closing fence
      // the box costs a border (2) and paddingX (2)
      const codeW = Math.max(8, w - 4);
      let code = buf.flatMap((l) => wrapHard(l, codeW)).join("\n");
      try {
        code = highlight(code, { language: lang, ignoreIllegals: true });
      } catch {
        /* keep raw */
      }
      blocks.push(
        <Box key={key++} flexDirection="column" width={w} borderStyle="round" borderColor={colors.dim} paddingX={1}>
          {code.split("\n").map((l, n) => (
            <Text key={n}>{l || " "}</Text>
          ))}
        </Box>,
      );
      continue;
    }

    // pipe table: a header row, a |---|---| separator, then body rows
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const rows = [splitRow(line)];
      i += 2; // header + separator
      while (i < lines.length && isTableRow(lines[i])) rows.push(splitRow(lines[i++]));
      blocks.push(<Table key={key++} rows={rows} width={w} />);
      continue;
    }

    // horizontal rule
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      blocks.push(
        <Text key={key++} color={colors.dim}>{"─".repeat(w)}</Text>,
      );
      i++;
      continue;
    }

    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(
        <Box key={key++} flexDirection="column">
          {wrapProse(h[2], w).map((r, n) => (
            <Text key={n} bold color={colors.iqMagenta}>{r}</Text>
          ))}
        </Box>,
      );
      i++;
      continue;
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      blocks.push(
        <Box key={key++} flexDirection="column">
          {wrapProse(line.replace(/^>\s?/, ""), w - 2).map((r, n) => (
            <Text key={n} color={colors.dim} italic>▎ {r}</Text>
          ))}
        </Box>,
      );
      i++;
      continue;
    }

    // bullet / numbered list item
    const bullet = /^(\s*)([-*+])\s+(.*)$/.exec(line);
    const num = /^(\s*)(\d+)\.\s+(.*)$/.exec(line);
    if (bullet || num) {
      const m = (bullet ?? num)!;
      const indent = Math.floor(m[1].length / 2);
      const marker = bullet ? "•" : `${m[2]}.`;
      // continuation rows hang under the text, not under the marker
      const textW = Math.max(8, w - indent - displayWidth(marker) - 1);
      const rows = wrapProse(m[3], textW);
      blocks.push(
        <Box key={key++} paddingLeft={indent} flexDirection="column">
          {rows.map((r, n) => (
            <Box key={n}>
              <Text color={colors.iqCyan}>{n === 0 ? `${marker} ` : " ".repeat(displayWidth(marker) + 1)}</Text>
              <Text>
                <Inline text={r} />
              </Text>
            </Box>
          ))}
        </Box>,
      );
      i++;
      continue;
    }

    // blank line → spacer
    if (line.trim() === "") {
      blocks.push(<Text key={key++}> </Text>);
      i++;
      continue;
    }

    // paragraph
    blocks.push(
      <Box key={key++} flexDirection="column">
        {wrapProse(line, w).map((r, n) => (
          <Text key={n}>
            <Inline text={r} />
          </Text>
        ))}
      </Box>,
    );
    i++;
  }

  return <Box flexDirection="column" width={w}>{blocks}</Box>;
}
