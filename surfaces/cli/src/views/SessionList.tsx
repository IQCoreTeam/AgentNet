import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { SessionMeta } from "@iqlabs-official/agent-sdk/runtime/contract";
import { colors, copy, glyph, rule, tag } from "../theme.js";
import { displayWidth } from "../format.js";

// Compact uppercase age, design-project style: 12S / 5M / 2H / 3D.
function age(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}S`;
  if (s < 3600) return `${Math.floor(s / 60)}M`;
  if (s < 86400) return `${Math.floor(s / 3600)}H`;
  return `${Math.floor(s / 86400)}D`;
}

// Pad/trim a string to an exact CELL width (Hangul/CJK count 2) so the inverted
// rows form a solid rectangle.
function cell(s: string, w: number): string {
  let out = "";
  let used = 0;
  for (const ch of s) {
    const cw = displayWidth(ch);
    if (used + cw > w) break;
    out += ch;
    used += cw;
  }
  return out + " ".repeat(Math.max(0, w - used));
}

// Session picker, tab 07 of the design: sessions STACK VERTICALLY, one row each behind
// bone rules. The selected row inverts edge to edge and grows a meta sub-line (age,
// engine, last device); the live session carries ● LIVE in green. Long lists window
// around the selection. ↑/↓ move, ↵ resume, f fork, d delete, esc back; the footer's
// right edge reports where sessions sync to.
export function SessionList({
  sessions,
  activeId,
  cloud,
  onResume,
  onDelete,
  onFork,
  onClose,
}: {
  sessions: SessionMeta[];
  activeId?: string;
  cloud: string | null;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  onFork: (id: string) => void;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const clamped = Math.min(idx, Math.max(0, sessions.length - 1));
  const w = Math.max(0, (process.stdout.columns || 80) - 2);

  useInput((input, key) => {
    if (key.escape) return onClose();
    if (sessions.length === 0) return;
    if (key.upArrow) return setIdx(() => Math.max(0, clamped - 1));
    if (key.downArrow) return setIdx(() => Math.min(sessions.length - 1, clamped + 1));
    if (key.return) onResume(sessions[clamped].sessionId);
    else if (input === "f") onFork(sessions[clamped].sessionId);
    else if (input === "d") {
      onDelete(sessions[clamped].sessionId);
      setIdx((i) => Math.max(0, Math.min(i, sessions.length - 2)));
    }
  });

  // Window the list so the frame never outgrows the terminal: the selected row costs 2
  // rows + rule, the rest 1 + rule, plus header(2) + footer(1) + closing rule and the
  // frame's own chrome outside this component.
  const maxVisible = Math.max(3, Math.floor(((process.stdout.rows || 24) - 9) / 2));
  const start = Math.min(Math.max(0, clamped - Math.floor(maxVisible / 2)), Math.max(0, sessions.length - maxVisible));
  const visible = sessions.slice(start, start + maxVisible);
  const above = start;
  const below = sessions.length - start - visible.length;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text color={colors.bone} bold>{tag("sessions")}</Text>
        <Text dimColor>{sessions.length} SESSION{sessions.length === 1 ? "" : "S"} · ENCRYPTED</Text>
      </Box>
      <Text color={colors.bone}>{rule(w)}</Text>

      {sessions.length === 0 ? (
        <Text dimColor>{copy.emptySessions}</Text>
      ) : (
        <>
          {above > 0 ? <Text dimColor>{`  ↑ ${above} MORE`}</Text> : null}
          {visible.map((s, vi) => {
            const i = start + vi;
            const n = String(i + 1).padStart(2, "0");
            const live = s.sessionId === activeId;
            const engine = s.cli === "codex" ? glyph.codex : glyph.claude;
            const focused = i === clamped;
            const right = live ? "● LIVE" : age(s.ts);

            if (!focused) {
              return (
                <React.Fragment key={s.sessionId}>
                  {vi > 0 ? <Text color={colors.bone}>{rule(w)}</Text> : null}
                  <Box width={w} justifyContent="space-between">
                    <Text>
                      <Text dimColor>{`  S.${n}  `}</Text>
                      <Text color={colors.bone}>{s.title || "untitled"}</Text>
                    </Text>
                    <Text color={live ? colors.ok : colors.dim}>{right}</Text>
                  </Box>
                </React.Fragment>
              );
            }

            const meta = [
              `${age(s.ts).toLowerCase()} ago`,
              `${engine} ${s.cli}`,
              s.lastDevice?.label,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <React.Fragment key={s.sessionId}>
                {vi > 0 ? <Text color={colors.bone}>{rule(w)}</Text> : null}
                <Text backgroundColor={colors.bone} bold>
                  <Text color={colors.ok}> ❯ </Text>
                  <Text color={colors.ink}>{cell(`S.${n}  ${s.title || "untitled"}`, Math.max(0, w - 3 - displayWidth(right) - 1))}</Text>
                  <Text color={live ? colors.ok : colors.ink}>{right} </Text>
                </Text>
                <Text backgroundColor={colors.bone} color={colors.ink}>
                  {cell(`        ${meta}`, w)}
                </Text>
              </React.Fragment>
            );
          })}
          {below > 0 ? <Text dimColor>{`  ↓ ${below} MORE`}</Text> : null}
        </>
      )}

      <Text color={colors.bone}>{rule(w)}</Text>
      <Box justifyContent="space-between">
        <Text dimColor>↑/↓ MOVE · ↵ RESUME · F FORK · D DELETE · ESC BACK</Text>
        <Text dimColor>{cloud ? `SYNC: ${cloud.toUpperCase()} ◉` : "LOCAL ONLY ○"}</Text>
      </Box>
    </Box>
  );
}
