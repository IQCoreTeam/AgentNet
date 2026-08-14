// Live publish progress — ported from surfaces/webview/src/market/PublishForm.tsx.
// Three phases (store the body -> mint the NFT -> list for sale), each a separate
// wallet signature; store carries an optional 0..100 sub-percent for the code-in chunking.
import React from "react";
import { Box, Text } from "ink";
import { colors } from "../../theme.js";
import { Band } from "../../components/Band.js";

export interface PublishProgress {
  phase: "store" | "mint" | "list";
  signed: number;
  total?: number; // predicted total signatures (core estimatePublishSigns)
  percent?: number;
  kind: "skill" | "workflow";
}

// design tab 25: three numbered phases, each with a one-line status of what that
// signature does.
const PHASES: { key: PublishProgress["phase"]; label: string; sub: string }[] = [
  { key: "store", label: "STORE", sub: "code-in chunks" },
  { key: "mint", label: "MINT", sub: "creating token-2022 mint" },
  { key: "list", label: "LIST", sub: "register price · self mint #1" },
];

export function PublishProgressView({ progress }: { progress: PublishProgress | null }) {
  const idx = progress ? Math.max(0, PHASES.findIndex((p) => p.key === progress.phase)) : 0;
  const signed = progress?.signed ?? 0;
  const total = progress?.total;
  // signed/total is the true progress when the core predicts the total; the phase+percent
  // heuristic remains as the fallback for an older core without the estimate.
  const sub = progress?.phase === "store" && progress.percent != null ? progress.percent / 100 : idx > 0 ? 1 : 0;
  const overall = progress ? Math.min(100, Math.round((total ? signed / total : (idx + sub) / PHASES.length) * 100)) : 0;
  // Segmented forge gauge, mirroring the webview's 14-cell bar (unlock-flow design).
  const CELLS = 14;
  const filled = Math.round((overall / 100) * CELLS);
  const remaining = total && total > signed ? total - signed : null;
  return (
    <Box flexDirection="column" marginTop={1}>
      {PHASES.map((p, i) => (
        <Box key={p.key} justifyContent="space-between">
          <Text color={i < idx ? colors.ok : i === idx ? colors.iqCyan : colors.dim} bold={i === idx}>
            {i < idx ? "✓" : i === idx ? "▸" : "○"} {i + 1} · {p.label}
          </Text>
          <Text dimColor>{i < idx ? "done" : i === idx ? p.sub : ""}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text>
          <Text color={colors.iqCyan}>{"▰".repeat(filled)}</Text>
          <Text color={colors.dim}>{"▱".repeat(CELLS - filled)}</Text>
          <Text dimColor> {overall}%</Text>
        </Text>
      </Box>
      <Text dimColor>
        {signed > 0
          ? `${signed}${total ? `/${total}` : ""} SIGNATURES_APPROVED`
          : "waiting for the first signature…"}
      </Text>
      {remaining ? (
        <Box marginTop={1}>
          <Band
            label="next"
            note={`APPROVE IN YOUR WALLET · ${remaining} SIGNATURE${remaining === 1 ? "" : "S"} LEFT`}
            inverted
          />
        </Box>
      ) : null}
    </Box>
  );
}
