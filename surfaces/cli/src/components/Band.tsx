import React from "react";
import { Box, Text } from "ink";
import { colors, tag } from "../theme.js";
import { padCells, displayWidth } from "../format.js";

// The design's section band (tabs 05/08/24/25): a full-width row with a //LABEL_ pinned
// left and a note pinned right. `inverted` fills the row bone-on-ink for the one band a
// screen wants to shout (//BUY_, //NEXT_). One source of truth so every screen's bands
// line up instead of each re-deriving the padding.
export function Band({
  label,
  note,
  inverted = false,
  width,
}: {
  label: string;
  note: string;
  inverted?: boolean;
  width?: number;
}) {
  // Market/detail screens sit inside a rounded box with paddingX={1}: border 2 + pad 2.
  const w = Math.max(12, (width ?? process.stdout.columns ?? 80) - 4);
  const left = tag(label);
  const gap = w - displayWidth(left) - displayWidth(note);

  if (inverted) {
    const row = gap >= 1 ? left + " ".repeat(gap) + note : `${left} ${note}`;
    return (
      <Text backgroundColor={colors.bone} color={colors.ink} bold>
        {padCells(row.slice(0, w), w)}
      </Text>
    );
  }
  return (
    <Box width={w} justifyContent="space-between">
      <Text bold color={colors.bone}>
        {left}
      </Text>
      <Text dimColor wrap="truncate-end">
        {note}
      </Text>
    </Box>
  );
}
