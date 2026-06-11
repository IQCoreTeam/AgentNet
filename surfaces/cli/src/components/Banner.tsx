import React from "react";
import { Box, Text } from "ink";
import Gradient from "ink-gradient";
import BigText from "ink-big-text";
import { gradients, copy } from "../theme.js";
import { useFrameLoop } from "../hooks/useFrameLoop.js";
import { useTypewriter } from "../hooks/useTypewriter.js";

// The wake-up animation: the IQ mark with a gradient whose colors ROTATE (a sweep),
// and the wordmark typed out beneath it. Both settle to static when delight is off.
export function Banner() {
  // rotate the IQ color stops each frame → a left-to-right shimmer across the letters.
  const base = gradients.iq;
  const f = useFrameLoop(base.length, 4);
  const swept = [...base.slice(f), ...base.slice(0, f)];
  const { shown } = useTypewriter(copy.wordmark, 60);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Gradient colors={swept}>
        <BigText text="IQ" />
      </Gradient>
      <Text dimColor>{shown}</Text>
    </Box>
  );
}
