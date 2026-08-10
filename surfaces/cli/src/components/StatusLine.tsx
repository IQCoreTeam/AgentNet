import React from "react";
import { Box, Text } from "ink";
import { basename } from "node:path";
import { Iggy, type Mood } from "./Iggy.js";
import { colors } from "../theme.js";

// Block-fill bar showing context used. 8 cells wide; partial block not needed at this
// resolution. Fills left-to-right as tokens are consumed (used = filled).
function CtxBar({ used, approx }: { used: number; approx: boolean }) {
  const CELLS = 8;
  const filled = Math.round(used * CELLS);
  const color = used < 0.6 ? colors.ok : used < 0.85 ? colors.warn : colors.err;
  const bar = "█".repeat(filled) + "░".repeat(CELLS - filled);
  return (
    <Text color={color}>
      {approx ? "~" : ""}[{bar}]
    </Text>
  );
}

function fmtK(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

export function StatusLine({
  mood,
  cli,
  model,
  effort,
  cwd,
  elapsed,
  sync,
  ctx,
  ctxTokens,
  ctxWindow,
  ctxApprox,
}: {
  mood: Mood;
  cli: "claude" | "codex";
  model?: string;
  effort?: string;
  cwd: string;
  elapsed?: number;
  sync?: { ok: boolean; error?: string; reason?: "reauth" | "transient" } | null;
  ctx?: number;        // fraction USED (0..1); undefined = no data yet
  ctxTokens?: number; // raw tokens used (for label)
  ctxWindow?: number; // model window size (for label)
  ctxApprox?: boolean;
}) {
  const usedFrac = ctx ?? 0;
  const tokenLabel = ctxTokens !== undefined && ctxWindow !== undefined
    ? `${fmtK(ctxTokens)}/${fmtK(ctxWindow)}`
    : ctx !== undefined ? `${Math.round(usedFrac * 100)}%` : "";

  // One status band, design-project style:
  //   ( ◕ ◡ ◕ )  CLAUDE · default · repo · SYNCED        [██░░░░░░] 31k/200k · ⏱ 12.4s
  return (
    <Box justifyContent="space-between">
      <Box>
        <Iggy mood={mood} />
        <Text color={colors.bone} bold>{"  "}{cli.toUpperCase()}</Text>
        <Text dimColor> · {model ?? "default"}</Text>
        {effort ? <Text dimColor> · {effort}</Text> : null}
        <Text dimColor> · {basename(cwd) || cwd}</Text>
        {sync ? (
          <Text color={sync.ok ? colors.ok : colors.err}>
            {" · "}
            {sync.ok ? "SYNCED" : sync.reason === "reauth" ? "RECONNECT (/storage)" : "OFFLINE"}
          </Text>
        ) : null}
      </Box>
      <Box>
        {ctx !== undefined ? (
          <>
            <CtxBar used={usedFrac} approx={!!ctxApprox} />
            <Text dimColor> {tokenLabel}</Text>
          </>
        ) : null}
        {elapsed !== undefined ? <Text dimColor> · ⏱ {elapsed.toFixed(1)}s</Text> : null}
      </Box>
    </Box>
  );
}
