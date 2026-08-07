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
  const tint = cli === "codex" ? colors.codex : colors.claude;
  const modelLabel = model ?? "default";
  const cols = process.stdout.columns || 80;
  const shortcuts =
    cols >= 90
      ? ["? /help", "Esc cancel", "/new session", "/account"]
      : cols >= 64
        ? ["? /help", "Esc cancel"]
        : ["? /help"];

  return (
    <Box justifyContent="space-between" marginTop={1} paddingX={1}>
      {/* left: shortcuts */}
      <Box>
        {shortcuts.map((s, i) => (
          <Text key={s} dimColor>
            {i > 0 ? "  ·  " : ""}
            {s}
          </Text>
        ))}
      </Box>

      {/* right: engine + model pill */}
      <Box>
        <Text color={busy ? colors.iqViolet : tint} bold>{"● "}</Text>
        <Text color={tint} bold>{cli}</Text>
        <Text dimColor>  ·  {modelLabel}</Text>
      </Box>
    </Box>
  );
}
