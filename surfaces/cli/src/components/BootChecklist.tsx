import React from "react";
import { Box, Text } from "ink";
import { Spinner } from "./Spinner.js";
import { glyph, colors, tag as tagOf } from "../theme.js";

export type BootStatus = "pending" | "ok" | "fail";
export interface BootStep {
  tag: string; // the //TAG_ shown on the left of the band (wallet / claude / …)
  label: string; // human line, kept as the fallback right-side value when no detail
  status: BootStatus;
  detail?: string; // the value shown on the right when resolved (address, OK, version…)
}

// The live boot status, drawn as the design's stacked full-width bands (tab 01): each
// engine/check is one justified row — //TAG_ on the left, its live state on the right.
// A spinner runs while pending, then the row flips to the real ✓/✗ result — honest
// status, not theater. Renders fine without animation (spinner falls back to a static
// frame).
export function BootChecklist({ steps }: { steps: BootStep[] }) {
  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      {steps.map((s, i) => (
        <Box key={i} justifyContent="space-between">
          <Text bold color={s.status === "fail" ? colors.err : colors.bone}>
            {tagOf(s.tag)}
          </Text>
          {s.status === "pending" ? (
            <Text color={colors.ok}>
              <Spinner /> connecting…
            </Text>
          ) : s.status === "ok" ? (
            <Text color={colors.ok}>
              {s.detail ?? s.label} {glyph.ok}
            </Text>
          ) : (
            <Text color={colors.err}>
              {glyph.fail} {s.detail ?? s.label}
            </Text>
          )}
        </Box>
      ))}
    </Box>
  );
}
