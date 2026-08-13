import React from "react";
import { Box, Text } from "ink";
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
  cli: "claude" | "codex";
  model?: string;
  busy: boolean;
}) {
  const modelLabel = (model ?? "default").toUpperCase();
  const cols = process.stdout.columns || 80;
  // The design's footer names the panels that open (SESSIONS, MODEL) rather than raw
  // slash commands — /sessions and /model open exactly these, so the labels stay honest.
  const shortcuts =
    cols >= 90
      ? ["? /HELP", "ESC CANCEL", "SESSIONS", "MODEL"]
      : cols >= 64
        ? ["? /HELP", "SESSIONS", "MODEL"]
        : ["? /HELP"];

  return (
    <Box justifyContent="space-between">
      {/* left: shortcuts */}
      <Box>
        {shortcuts.map((s, i) => (
          <Text key={s} dimColor>
            {i > 0 ? " · " : ""}
            {s}
          </Text>
        ))}
      </Box>

      {/* right: engine + model */}
      <Box>
        <Text color={busy ? colors.warn : colors.ok} bold>{"● "}</Text>
        <Text color={colors.bone} bold>{cli.toUpperCase()}</Text>
        <Text dimColor> · {modelLabel}</Text>
      </Box>
    </Box>
  );
}
