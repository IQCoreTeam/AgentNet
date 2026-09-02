import React from "react";
import { Box, Text } from "ink";
import type { EngineKey } from "@iqlabs-official/agent-sdk";
import { colors } from "../theme.js";

// Bottom hint row — left: keyboard shortcuts, right: engine + model pill.
// Mirrors the Claude Code footer (`? for shortcuts · ← for agents   ● high · /effort`).
// Shortcuts shed items on narrow terminals — a wrapped footer breaks the one-line
// contract the composer's cursor pin depends on.
export function Footer({
  cli,
  model,
  busy,
}: {
  cli: EngineKey;
  model?: string;
  busy: boolean;
}) {
  const modelLabel = (model ?? "default").toUpperCase();
  const cols = process.stdout.columns || 80;
  // The design's footer names the panels that open (SESSIONS, MODEL) rather than raw
  // slash commands — /sessions and /model open exactly these, so the labels stay honest.
  // The esc hint appears only while a turn is running: idle, esc does nothing at the top
  // level, and a hint for a dead key teaches users to distrust the footer. Busy, esc
  // interrupts the turn, so the label says INTERRUPT (same word the status row uses).
  const shortcuts =
    cols >= 90
      ? ["? /HELP", ...(busy ? ["ESC INTERRUPT"] : []), "SESSIONS", "MODEL"]
      : cols >= 64
        ? ["? /HELP", "SESSIONS", "MODEL"]
        : ["? /HELP"];

  return (
    <Box justifyContent="space-between">
      {/* left: shortcuts - pinned (flexShrink 0): these are the advertised keys, so they
          never shed characters; the pill on the right takes all the shrink */}
      <Box flexShrink={0}>
        {shortcuts.map((s, i) => (
          <Text key={s} dimColor>
            {i > 0 ? " · " : ""}
            {s}
          </Text>
        ))}
      </Box>

      {/* right: engine + model. The glyph and engine name are pinned (flexShrink 0) and
          the model label truncates, so when the pill outgrows a narrow terminal it
          shrinks by shedding model characters instead of wrapping onto a second row -
          the same one-line contract the shortcuts keep by shedding items. The paddingLeft
          keeps one honest gap from the shortcuts when the row is completely full. */}
      <Box paddingLeft={1}>
        <Box flexShrink={0}>
          <Text color={busy ? colors.warn : colors.ok} bold>{"● "}</Text>
          {/* custom wears the theme's violet accent so the pill says which brain answers */}
          <Text color={cli === "custom" ? colors.iqViolet : colors.bone} bold>{cli.toUpperCase()}</Text>
        </Box>
        <Text dimColor wrap="truncate-end"> · {modelLabel}</Text>
      </Box>
    </Box>
  );
}
