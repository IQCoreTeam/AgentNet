import React from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { colors } from "../theme.js";

// Horizontal "collectible chip" carousel - rotate through items with ←/→ like flipping
// cards in a binder. Owns ONLY the left/right arrows; the parent keeps its own useInput
// for Enter/Esc/d/etc (multiple useInput hooks coexist fine in Ink). Windowed to the
// terminal width so it never overflows, whatever the item count.
export function ChipCarousel<T>({
  items,
  index,
  onIndex,
  renderChip,
  title,
  hint,
  chipWidth = 24,
}: {
  items: T[];
  index: number;
  onIndex: (i: number) => void;
  renderChip: (item: T, focused: boolean) => React.ReactNode;
  title?: string;
  hint?: string;
  chipWidth?: number;
}) {
  // || not ??: a detached pty reports columns 0, which would window to a single chip
  const cols = useStdout().stdout?.columns || 80;
  const visible = Math.max(1, Math.floor((cols - 4) / (chipWidth + 1)));
  const start = Math.max(0, Math.min(index - Math.floor(visible / 2), Math.max(0, items.length - visible)));

  useInput((_input, key) => {
    if (key.leftArrow) onIndex(Math.max(0, index - 1));
    else if (key.rightArrow) onIndex(Math.min(items.length - 1, index + 1));
  });

  return (
    <Box flexDirection="column">
      {title ? (
        <Text bold color={colors.iqMagenta}>{title}</Text>
      ) : null}
      <Box>
        <Box width={2}>
          <Text color={start > 0 ? colors.iqCyan : colors.dim}>{start > 0 ? "‹ " : "  "}</Text>
        </Box>
        {items.slice(start, start + visible).map((item, wi) => (
          <Box key={start + wi} marginRight={1}>
            {renderChip(item, start + wi === index)}
          </Box>
        ))}
        <Box width={2}>
          <Text color={start + visible < items.length ? colors.iqCyan : colors.dim}>
            {start + visible < items.length ? "›" : " "}
          </Text>
        </Box>
      </Box>
      <Box>
        <Text dimColor>{items.length > 0 ? `${index + 1} / ${items.length}` : ""}</Text>
        {hint ? <Text dimColor>{items.length > 0 ? "   " : ""}{hint}</Text> : null}
      </Box>
    </Box>
  );
}
