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

export function HeliusBadge({ status }: { status: RpcStatusLite | null }) {
  if (!status) return null;
  if (status.hasKey) {
    return <Text color={colors.ok}>● {status.network} · {status.masked}</Text>;
  }
  return <Text color={colors.warn}>add a Helius key for faster results</Text>;
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
