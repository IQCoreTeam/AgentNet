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
  sync?: { ok: boolean; error?: string } | null;
  ctx?: number;        // fraction USED (0..1); undefined = no data yet
  ctxTokens?: number; // raw tokens used (for label)
  ctxWindow?: number; // model window size (for label)
  ctxApprox?: boolean;
}) {
  const tint = cli === "codex" ? colors.codex : colors.claude;
  const usedFrac = ctx ?? 0;
  const tokenLabel = ctxTokens !== undefined && ctxWindow !== undefined
    ? ` ${fmtK(ctxTokens)} / ${fmtK(ctxWindow)}`
    : ctx !== undefined ? ` ${Math.round(usedFrac * 100)}%` : "";

  return (
    <Box marginTop={1} flexDirection="column">
      {/* main status row */}
      <Box>
        <Iggy mood={mood} />
        <Text color={tint} bold>{"  "}{cli}</Text>
        <Text dimColor>·{model ?? "default"}</Text>
        {effort ? <Text dimColor> ·{effort}</Text> : null}
        <Text dimColor> · {basename(cwd) || cwd}</Text>
        {elapsed !== undefined ? <Text color={colors.iqCyan}> · {elapsed.toFixed(1)}s</Text> : null}
        {sync ? (
          <Text color={sync.ok ? colors.ok : colors.err}>
            {" · "}{sync.ok ? "☁ synced" : "☁ offline"}
          </Text>
        ) : null}
      </Box>
      {/* context bar row — only shown once we have data (real or approx) */}
      {ctx !== undefined ? (
        <Box paddingLeft={4}>
          <CtxBar used={usedFrac} approx={!!ctxApprox} />
          <Text dimColor>{tokenLabel} ctx</Text>
        </Box>
      ) : null}
    </Box>
  );
}
