import React from "react";
import { Box, Text } from "ink";
import { colors } from "../theme.js";
import { basename } from "node:path";

// Big Iggy block — 3 rows, shown only in the startup header.
const BIG_IGGY = [
  " ╭───╮ ",
  " │◕‿◕│ ",
  " ╰───╯ ",
];

// Startup header: logo + app info. Mirrors the Claude Code header aesthetic.
// Shown only on a fresh / empty session so it doesn't re-appear mid-conversation.
export function Header({
  cli,
  model,
  cwd,
  version = "0.1.0",
}: {
  cli: "claude" | "codex";
  model?: string;
  cwd: string;
  version?: string;
}) {
  const tint = cli === "codex" ? colors.codex : colors.claude;
  const modelLabel = model ?? (cli === "claude" ? "claude sonnet" : "codex");

  return (
    <Box flexDirection="row" marginBottom={1} paddingX={1}>
      {/* pixel iggy */}
      <Box flexDirection="column" marginRight={2}>
        {BIG_IGGY.map((row, i) => (
          <Text key={i} color={tint} bold>{row}</Text>
        ))}
      </Box>

      {/* app info */}
      <Box flexDirection="column" justifyContent="center">
        <Box>
          <Text bold color={tint}>agentnet</Text>
          <Text dimColor>  v{version}</Text>
        </Box>
        <Text dimColor>{modelLabel}</Text>
        <Text dimColor>{basename(cwd) || cwd}</Text>
      </Box>
    </Box>
  );
}
