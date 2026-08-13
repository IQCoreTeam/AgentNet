import React from "react";
import { Box, Text } from "ink";
import { colors, surface, glyph } from "../theme.js";

// The first-run progress ladder from design tab 02. Five conceptual rungs; the CLI's
// many real onboarding steps (install, codex auth, gdrive…) collapse into whichever rung
// they belong to, so the user always sees WHERE they are and how much is left — without
// the functional flow having to change shape. `rung` is 1-based (1 = WALLET … 5 = chat).
const RUNGS = [
  { n: "01", label: "WALLET" },
  { n: "02", label: "ENGINE" },
  { n: "03", label: "WHERE SESSIONS LIVE" },
  { n: "04", label: "READING THE CHAIN" },
  { n: "05", label: "SAY SOMETHING" },
] as const;

export function SetupLadder({ rung, address }: { rung: number; address: string }) {
  const filled = Math.max(0, Math.min(RUNGS.length, rung));
  const meter = "█".repeat(filled) + "░".repeat(RUNGS.length - filled);
  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
  const left = RUNGS.length - rung;

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text bold>SETTING YOU UP</Text>
        <Text color={colors.ok}>{meter}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {RUNGS.map((r, i) => {
          const idx = i + 1;
          const done = idx < rung;
          const now = idx === rung;
          const mark = done ? glyph.ok : now ? "▶" : "○";
          const value = idx === 1 ? short : now ? "in progress" : "";
          const color = done ? colors.ok : now ? colors.ink : surface.locked;
          return (
            <Box key={r.n} justifyContent="space-between">
              <Text
                color={color}
                backgroundColor={now ? colors.bone : undefined}
                bold={now}
              >
                {` ${mark} ${r.n}  ${r.label} `}
              </Text>
              {value ? (
                <Text color={now ? colors.ink : colors.dim} backgroundColor={now ? colors.bone : undefined}>
                  {`${value} `}
                </Text>
              ) : null}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1} justifyContent="space-between">
        <Text color={colors.ok}>{glyph.sparkle} WALLET LINKED</Text>
        <Text dimColor>
          {left > 0 ? `${left} step${left === 1 ? "" : "s"} left · ` : ""}your key never leaves this machine
        </Text>
      </Box>
    </Box>
  );
}
