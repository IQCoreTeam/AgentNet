// Helius RPC status badge + settings entry — ported from
// surfaces/webview/src/market/MarketScreen.tsx + HeliusKeyForm.tsx. The public devnet
// RPC doesn't serve DAS reads, so the market nudges the user to add a Helius key.
// Core owns storage (saveHeliusKey/maskedHeliusKey/hasDasRpc, 0600 file) — this is
// pure render + a text field, matching the CLI's other composer patterns.
import React from "react";
import { Box, Text } from "ink";
import { colors } from "../../theme.js";

export interface RpcStatusLite {
  hasKey: boolean;
  masked: string | null;
  network: "devnet" | "mainnet";
}

// The badge's copy as plain text: HeliusBadge renders exactly this string, and
// SkillMarket measures displayWidth of it to decide whether the badge fits the header
// row. One source of truth, so the measurement can never drift from the render.
export function heliusBadgeText(status: RpcStatusLite | null): string {
  if (!status) return "";
  return status.hasKey ? `● ${status.network} · ${status.masked}` : "add a Helius key for faster results";
}

export function HeliusBadge({ status }: { status: RpcStatusLite | null }) {
  if (!status) return null;
  return <Text color={status.hasKey ? colors.ok : colors.warn}>{heliusBadgeText(status)}</Text>;
}

export function HeliusPanel({
  status,
  keyInput,
  busy,
  flash,
}: {
  status: RpcStatusLite | null;
  keyInput: string;
  busy: boolean;
  flash: string | null;
}) {
  return (
    <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
      <Text bold color={colors.iqMagenta}>❖ RPC settings</Text>
      <Box marginTop={1}>
        <Text dimColor>status  </Text>
        <HeliusBadge status={status} />
      </Box>
      <Box marginTop={1}>
        <Text color={colors.iqCyan}>▸ </Text>
        <Text dimColor>helius key </Text>
        <Text>{keyInput}</Text>
        <Text inverse> </Text>
      </Box>
      {flash ? <Box marginTop={1}><Text color={colors.ok}>{flash}</Text></Box> : null}
      {busy ? <Text dimColor>saving…</Text> : null}
      <Box marginTop={1}>
        <Text dimColor>paste key or full RPC URL · ↵ save · [x] clear key · esc back</Text>
      </Box>
    </Box>
  );
}
