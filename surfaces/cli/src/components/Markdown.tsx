import React from "react";
import { Box, Text } from "ink";
import { highlight } from "cli-highlight";
import { colors } from "../theme.js";

// A small, dependency-light markdown renderer for the terminal. Handles the blocks that
// actually show up in assistant replies: headings, bullet/numbered lists, fenced code
// (syntax-highlighted), blockquotes, and inline **bold** / *italic* / `code` / [links].
// Not a full CommonMark engine — just the 90% that matters, rendered as Ink nodes.

// ── inline spans ───────────────────────────────────────────────────────────────
const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

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

// ── block parse ────────────────────────────────────────────────────────────────
export function Markdown({ text }: { text: string }) {
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
      let code = buf.join("\n");
      try {
        code = highlight(code, { language: lang, ignoreIllegals: true });
      } catch {
        /* keep raw */
      }
      blocks.push(
        <Box key={key++} flexDirection="column" borderStyle="round" borderColor={colors.dim} paddingX={1}>
          <Text>{code}</Text>
        </Box>,
      );
      continue;
    }

    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(
        <Text key={key++} bold color={colors.iqMagenta}>
          {h[2]}
        </Text>,
      );
      i++;
      continue;
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      blocks.push(
        <Text key={key++} color={colors.dim} italic>
          ▎ <Inline text={line.replace(/^>\s?/, "")} />
        </Text>,
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
      blocks.push(
        <Box key={key++} paddingLeft={indent}>
          <Text color={colors.iqCyan}>{marker} </Text>
          <Text>
            <Inline text={m[3]} />
          </Text>
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
      <Text key={key++}>
        <Inline text={line} />
      </Text>,
    );
    i++;
  }

  return <Box flexDirection="column">{blocks}</Box>;
}
