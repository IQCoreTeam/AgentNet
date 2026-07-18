// Live publish progress — ported from surfaces/webview/src/market/PublishForm.tsx.
// Three phases (store the body -> mint the NFT -> list for sale), each a separate
// wallet signature; store carries an optional 0..100 sub-percent for the code-in chunking.
import React from "react";
import { Box, Text } from "ink";
import { colors } from "../../theme.js";

export interface PublishProgress {
  phase: "store" | "mint" | "list";
  signed: number;
  total?: number; // predicted total signatures (core estimatePublishSigns)
  percent?: number;
  kind: "skill" | "workflow";
}

const PHASES: { key: PublishProgress["phase"]; label: string }[] = [
  { key: "store", label: "storing on-chain" },
  { key: "mint", label: "minting the NFT" },
  { key: "list", label: "listing for sale" },
];

export function PublishProgressView({ progress }: { progress: PublishProgress | null }) {
  const idx = progress ? Math.max(0, PHASES.findIndex((p) => p.key === progress.phase)) : 0;
  const signed = progress?.signed ?? 0;
  const total = progress?.total;
  // signed/total is the true progress when the core predicts the total; the phase+percent
  // heuristic remains as the fallback for an older core without the estimate.
  const sub = progress?.phase === "store" && progress.percent != null ? progress.percent / 100 : idx > 0 ? 1 : 0;
  const overall = progress ? Math.min(100, Math.round((total ? signed / total : (idx + sub) / PHASES.length) * 100)) : 0;
  return (
    <Box flexDirection="column" marginTop={1}>
      {PHASES.map((p, i) => (
        <Text key={p.key} color={i < idx ? colors.ok : i === idx ? colors.iqCyan : colors.dim}>
          {i < idx ? "✓" : i === idx ? "▸" : "○"} {p.label}
        </Text>
      ))}
      <Text dimColor>{overall}% · {signed > 0 ? `${signed}${total ? `/${total}` : ""} signature${signed === 1 && !total ? "" : "s"} approved` : "waiting for the first signature…"}</Text>
    </Box>
  );
}
