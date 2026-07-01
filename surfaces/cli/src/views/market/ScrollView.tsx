// In-view scroll viewport — the CLI's answer to the webview's free-scrolling panels.
// A fixed-height Box slices a line array to [offset, offset+height) plus a footer
// showing position, so long content (SKILL.md, comment stacks, blog carousels) never
// blows past the terminal without dumping raw text into native scrollback.
import React from "react";
import { Box, Text } from "ink";

// Scroll offset itself lives in the parent (SkillMarket's single useInput handler owns
// all key routing); this component just renders the [offset, offset+height) slice.
// Parents clamp with the same math as __selfCheck below.
export function ScrollView({
  lines,
  height,
  offset,
  title,
}: {
  lines: React.ReactNode[];
  height: number;
  offset: number;
  title?: string;
}) {
  const total = lines.length;
  const visible = lines.slice(offset, offset + height);
  const end = Math.min(total, offset + height);
  return (
    <Box flexDirection="column">
      {title ? <Text dimColor>── {title} ──</Text> : null}
      <Box flexDirection="column" minHeight={height}>
        {visible.map((l, i) => (
          <Box key={offset + i}>{typeof l === "string" ? <Text>{l}</Text> : l}</Box>
        ))}
      </Box>
      {total > height ? (
        <Text dimColor>
          {offset > 0 ? "▲" : " "} {offset + 1}–{end}/{total} {end < total ? "▼" : " "}
        </Text>
      ) : null}
    </Box>
  );
}

// ponytail: assert-based self-check for the slice-window clamp logic.
export function __selfCheck(): void {
  const assert = (cond: boolean, msg: string) => { if (!cond) throw new Error(`ScrollView self-check failed: ${msg}`); };
  const clampWith = (total: number, height: number, n: number) => Math.max(0, Math.min(Math.max(0, total - height), n));
  assert(clampWith(10, 5, -3) === 0, "clamps below zero");
  assert(clampWith(10, 5, 100) === 5, "clamps at maxOffset (total-height)");
  assert(clampWith(3, 5, 2) === 0, "content shorter than viewport -> maxOffset 0");
}
