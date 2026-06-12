import React from "react";
import { Box, Text } from "ink";
import { colors } from "../theme.js";

// Bottom hint row — left: keyboard shortcuts, right: engine + model pill.
// Mirrors the Claude Code footer (`? for shortcuts · ← for agents   ● high · /effort`).
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

  return (
    <Box justifyContent="space-between" marginTop={1} paddingX={1}>
      {/* left: shortcuts */}
      <Box>
        <Text dimColor>? /help</Text>
        <Text dimColor>  ·  </Text>
        <Text dimColor>Esc cancel</Text>
        <Text dimColor>  ·  </Text>
        <Text dimColor>/new session</Text>
        <Text dimColor>  ·  </Text>
        <Text dimColor>/account</Text>
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
