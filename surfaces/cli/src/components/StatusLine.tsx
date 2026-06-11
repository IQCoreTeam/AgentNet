import React from "react";
import { Box, Text } from "ink";
import { basename } from "node:path";
import { Iggy, type Mood } from "./Iggy.js";
import { colors } from "../theme.js";

export function StatusLine({
  mood,
  cli,
  model,
  cwd,
  elapsed,
  sync,
  ctx,
  ctxApprox,
}: {
  mood: Mood;
  cli: "claude" | "codex";
  model?: string;
  cwd: string;
  elapsed?: number; // seconds into the current turn (undefined = idle)
  sync?: { ok: boolean; error?: string } | null;
  ctx?: number; // fraction of context left (0..1)
  ctxApprox?: boolean; // true = estimated (chars/4) before the engine reports real usage
}) {
  const tint = cli === "codex" ? colors.codex : colors.claude;
  const ctxColor = ctx === undefined ? colors.dim : ctx > 0.4 ? colors.ok : ctx > 0.15 ? colors.warn : colors.err;
  return (
    <Box marginTop={1}>
      <Iggy mood={mood} />
      <Text color={tint} bold>
        {"  "}
        {cli}
      </Text>
      <Text dimColor>·{model ?? "default"}</Text>
      <Text dimColor> · {basename(cwd) || cwd}</Text>
      {elapsed !== undefined ? <Text color={colors.iqCyan}> · {elapsed.toFixed(1)}s</Text> : null}
      {ctx !== undefined ? <Text color={ctxColor}> · ctx {ctxApprox ? "~" : ""}{Math.round(ctx * 100)}%</Text> : null}
      {sync ? (
        <Text color={sync.ok ? colors.ok : colors.err}> · {sync.ok ? "☁ synced" : "☁ offline"}</Text>
      ) : null}
    </Box>
  );
}
