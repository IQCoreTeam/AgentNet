import React from "react";
import { Box, Text } from "ink";
import { Iggy, type Mood } from "./Iggy.js";
import { colors } from "../theme.js";

// Block-fill bar showing context used. 8 cells wide; partial block not needed at this
// resolution. Fills left-to-right as tokens are consumed (used = filled).
function CtxBar({ used, approx }: { used: number; approx: boolean }) {
  const CELLS = 8;
  const filled = Math.round(used * CELLS);
  const color = used < 0.6 ? colors.ok : used < 0.85 ? colors.warn : colors.err;
  const bar = "█".repeat(filled) + "░".repeat(CELLS - filled);
  return (
    <Text color={color}>
      {approx ? "~" : ""}[{bar}]
    </Text>
  );
}

function fmtK(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

// The face band. It carries ONE thing besides the mascot: what is happening right now.
// Engine, model, cwd and sync used to live here too, but the footer already prints the
// engine and model, and a second copy taught nobody anything - so this row gave its space
// to the status text and the separate activity row above it disappeared entirely.
export function StatusLine({
  mood,
  status,
  ctx,
  ctxTokens,
  ctxWindow,
  ctxApprox,
}: {
  mood: Mood;
  status?: React.ReactNode; // what the agent is doing right now, one row
  ctx?: number;        // fraction USED (0..1); undefined = no data yet
  ctxTokens?: number; // raw tokens used (for label)
  ctxWindow?: number; // model window size (for label)
  ctxApprox?: boolean;
}) {
  const usedFrac = ctx ?? 0;
  const tokenLabel = ctxTokens !== undefined && ctxWindow !== undefined
    ? `${fmtK(ctxTokens)}/${fmtK(ctxWindow)}`
    : ctx !== undefined ? `${Math.round(usedFrac * 100)}%` : "";

  // Still exactly one row: the frame is fixed height, so a wrap here shifts every band
  // below it and moves the caret the cursor pin is aimed at. The mascot is width-padded
  // (see Iggy) and the status text truncates rather than wrapping.
  const cols = process.stdout.columns || 80;

  return (
    <Box width={Math.max(0, cols - 2)}>
      {/* The mascot is padded to the widest animation frame (see Iggy) so it never
          RESIZES - but when the whole band is squeezed, those padding spaces WRAP,
          hanging a phantom blank row under the band. Clamp the slot to one row and
          clip the wrapped spaces: the same height={1} contract the status text keeps. */}
      <Box height={1} overflow="hidden">
        <Iggy mood={mood} />
      </Box>
      <Box flexGrow={1} paddingLeft={2} overflow="hidden">
        {status}
      </Box>
      {ctx !== undefined ? (
        <Box flexShrink={0}>
          <CtxBar used={usedFrac} approx={!!ctxApprox} />
          <Text dimColor wrap="truncate-end"> {tokenLabel}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
