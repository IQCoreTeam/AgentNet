import React from "react";
import { Box, Text } from "ink";
import { colors, copy } from "../theme.js";
import { MASCOT } from "./logo.js";
import { useTypewriter } from "../hooks/useTypewriter.js";

// The wake-up screen: the Iggy brand mascot drawn large in green, with the wordmark
// typed out beneath it. No gradient sweep — just the mark, settling to the welcome panel
// once boot completes.
export function Banner() {
  const { shown } = useTypewriter(copy.wordmark, 60);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="column">
        {MASCOT.map((row, i) => (
          <Text key={i} color={colors.ok}>{row}</Text>
        ))}
      </Box>
      <Text dimColor>{shown}</Text>
    </Box>
  );
}
