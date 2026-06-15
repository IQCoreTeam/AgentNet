import React from "react";
import { Text } from "ink";
import { spinnerFrames, colors } from "../theme.js";
import { useFrameLoop } from "../hooks/useFrameLoop.js";

// Our own braille spinner (no ink-spinner). Animates through the frame set via the same
// useFrameLoop every other animation uses; static first frame when delight is off.
export function Spinner({ color = colors.iqCyan }: { color?: string }) {
  const i = useFrameLoop(spinnerFrames.length, 12);
  return <Text color={color}>{spinnerFrames[i]}</Text>;
}
