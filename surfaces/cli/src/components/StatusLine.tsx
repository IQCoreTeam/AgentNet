import React from "react";
import { Box, Text } from "ink";
import { basename } from "node:path";
import { Iggy, IGGY_W, type Mood } from "./Iggy.js";
import { colors } from "../theme.js";
import { displayWidth } from "../cursorPin.js";

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

  const syncLabel = sync
    ? sync.ok ? "SYNCED" : sync.reason === "reauth" ? "RECONNECT (/storage)" : "OFFLINE"
    : "";

  // This band MUST stay exactly one row. It sits inside a fixed-height frame, so a band
  // that wraps to two rows steals a row from the transcript and shifts every band below
  // it — which clips the composer out of the frame and moves the caret the cursor pin is
  // aimed at. Its content width also changes constantly (the timer ticks, the token
  // label grows, the mascot animates), so "it fits on my terminal" is not a guarantee:
  // budget the width and SHED items until it fits, exactly like Footer does.
  const cols = process.stdout.columns || 80;
  const avail = cols - 2; // the frame's paddingX

  const rightW =
    (ctx !== undefined ? (ctxApprox ? 1 : 0) + 10 + 1 + displayWidth(tokenLabel) : 0) +
    (elapsed !== undefined ? displayWidth(` · ⏱ ${elapsed.toFixed(1)}s`) : 0);

  // left-hand segments, in the order they get dropped when space runs short. The engine
  // name and the sync chip are load-bearing (which brain am I talking to, is my work
  // safe) so they are never shed; cwd/effort/model are conveniences.
  const cwdLabel = basename(cwd) || cwd;
  const fixedW = IGGY_W + 2 + displayWidth(cli) + (syncLabel ? displayWidth(` · ${syncLabel}`) : 0);
  let showModel = true;
  let showEffort = Boolean(effort);
  let showCwd = true;
  const leftW = () =>
    fixedW +
    (showModel ? displayWidth(` · ${model ?? "default"}`) : 0) +
    (showEffort ? displayWidth(` · ${effort}`) : 0) +
    (showCwd ? displayWidth(` · ${cwdLabel}`) : 0);
  if (leftW() + rightW > avail) showCwd = false;
  if (leftW() + rightW > avail) showEffort = false;
  if (leftW() + rightW > avail) showModel = false;

  // One status band, design-project style:
  //   ( ◕ ◡ ◕ )  CLAUDE · default · repo · SYNCED        [██░░░░░░] 31k/200k · ⏱ 12.4s
  return (
    <Box justifyContent="space-between" width={avail}>
      <Box>
        <Iggy mood={mood} />
        <Text color={colors.bone} bold wrap="truncate-end">{"  "}{cli.toUpperCase()}</Text>
        {showModel ? <Text dimColor wrap="truncate-end"> · {model ?? "default"}</Text> : null}
        {showEffort ? <Text dimColor wrap="truncate-end"> · {effort}</Text> : null}
        {showCwd ? <Text dimColor wrap="truncate-end"> · {cwdLabel}</Text> : null}
        {syncLabel ? (
          <Text color={sync!.ok ? colors.ok : colors.err} wrap="truncate-end">
            {" · "}
            {syncLabel}
          </Text>
        ) : null}
      </Box>
      <Box>
        {ctx !== undefined ? (
          <>
            <CtxBar used={usedFrac} approx={!!ctxApprox} />
            <Text dimColor wrap="truncate-end"> {tokenLabel}</Text>
          </>
        ) : null}
        {elapsed !== undefined ? <Text dimColor wrap="truncate-end"> · ⏱ {elapsed.toFixed(1)}s</Text> : null}
      </Box>
    </Box>
  );
}
