import React from "react";
import { Box, Text } from "ink";
import { colors } from "../theme.js";

type Variant = "info" | "warn" | "error" | "success";

const TINT: Record<Variant, string> = {
  info:    colors.iqCyan,
  warn:    colors.warn,
  error:   colors.err,
  success: colors.ok,
};

function autoVariant(text: string): Variant {
  if (/error|fail|denied|invalid|unknown command/i.test(text)) return "error";
  if (/warn|caution/i.test(text))                               return "warn";
  if (/copied|resumed|switched|saved|loaded|fresh|success/i.test(text)) return "success";
  return "info";
}

// Left-bar accent banner — mirrors the Claude Code announcement style.
// ┃ bar tinted by variant; text is plain white (readable on dark bg).
export function NoticeBanner({ text, variant }: { text: string; variant?: Variant }) {
  const v = variant ?? autoVariant(text);
  return (
    <Box marginTop={1}>
      <Text color={TINT[v]} bold>{"┃ "}</Text>
      <Text>{text}</Text>
    </Box>
  );
}
