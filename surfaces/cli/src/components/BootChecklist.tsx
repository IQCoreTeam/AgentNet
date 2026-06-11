import React from "react";
import { Box, Text } from "ink";
import { Spinner } from "./Spinner.js";
import { glyph, colors } from "../theme.js";

export type BootStatus = "pending" | "ok" | "fail";
export interface BootStep {
  label: string;
  status: BootStatus;
  detail?: string;
}

// The live "waking engines…" list. Each line shows a spinner while pending, then flips
// to ✓/✗ as the real check (detectCli / wallet / storage) resolves — honest status, not
// theater. Renders fine without animation (spinner falls back to a static frame).
export function BootChecklist({ steps }: { steps: BootStep[] }) {
  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      {steps.map((s, i) => (
        <Box key={i}>
          <Box width={2}>
            {s.status === "pending" ? (
              <Spinner />
            ) : s.status === "ok" ? (
              <Text color={colors.ok}>{glyph.ok}</Text>
            ) : (
              <Text color={colors.err}>{glyph.fail}</Text>
            )}
          </Box>
          <Text color={s.status === "fail" ? colors.err : undefined}>{s.label}</Text>
          {s.detail ? <Text dimColor> {s.detail}</Text> : null}
        </Box>
      ))}
    </Box>
  );
}
