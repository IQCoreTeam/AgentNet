import React from "react";
import { Text } from "ink";
import { useDelight } from "./DelightProvider.js";
import { confetti, glyph, colors } from "../theme.js";

// A single-line reaction — sparkle on a finished turn, confetti when a tool looks like a
// win. Delight off → renders nothing. Kept to one line by design: delight, not noise.
export function Celebrate({ kind }: { kind: "sparkle" | "confetti" | null }) {
  const { animate } = useDelight();
  if (!animate || !kind) return null;
  if (kind === "confetti") return <Text color={colors.iqMagenta}>{confetti}</Text>;
  return <Text color={colors.iqCyan}>{glyph.sparkle} nice.</Text>;
}
