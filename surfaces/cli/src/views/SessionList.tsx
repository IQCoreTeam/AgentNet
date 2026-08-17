import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { SessionMeta } from "@iqlabs-official/agent-sdk/runtime/contract";
import { colors, copy, glyph, rule, tag } from "../theme.js";
import { displayWidth, graphemes } from "../format.js";

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
  for (const ch of graphemes(s)) {
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
// right edge reports where sessions sync to. The whole thing renders as a bordered
// panel centered on a full-height wrapper, so opening it clears the visible screen
// (the chat survives in terminal scrollback) instead of stacking under it.
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
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  // A framed panel floating on a cleared screen, not a full-bleed sheet: the wrapper
  // below fills the whole terminal, which pushes the chat into the terminal's own
  // scrollback (scroll up and it's all still there) and gives the picker real margins.
  const totalW = Math.max(44, Math.min(cols - 8, 84));
  const w = totalW - 4; // bold border (2) + paddingX(1) each side

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
  // rows + rule, the rest 1 + rule, plus the frame's chrome (border 2, paddingY 2,
  // header+rule 2, closing rule+footer 2, MORE indicators 2).
  const maxVisible = Math.max(3, Math.floor((rows - 13) / 2));
  const start = Math.min(Math.max(0, clamped - Math.floor(maxVisible / 2)), Math.max(0, sessions.length - maxVisible));
  const visible = sessions.slice(start, start + maxVisible);
  const above = start;
  const below = sessions.length - start - visible.length;

  return (
    <Box height={Math.max(10, rows - 1)} width={cols} justifyContent="center" alignItems="center">
      <Box flexDirection="column" width={totalW} borderStyle="bold" borderColor={colors.bone} paddingX={1} paddingY={1}>
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
            const live = s.sessionId === activeId;
            const engine = s.cli === "codex" ? glyph.codex : glyph.claude;
            const focused = i === clamped;
            // The old S.NN index was noise - it shifted whenever the list changed. The left
            // fixed column now carries the AGE instead (right-aligned so the titles line up);
            // the live session still gets ● LIVE on the right edge.
            const ageSlot = age(s.ts).padStart(4);
            const liveTag = live ? "● LIVE" : "";

            if (!focused) {
              const prefix = `  ${ageSlot}  `;
              // Trim the title to ONE line. An untruncated long title wraps to 2-3 rows,
              // and enough wrapped rows push the windowed box past the terminal height,
              // which trips ink's full-repaint and smears the whole list into scrollback -
              // the "it fills the screen" symptom. One line per row is exactly what lets
              // the window math keep the box on screen and scroll inside it instead.
              const titleMax = Math.max(1, w - displayWidth(prefix) - displayWidth(liveTag) - 1);
              return (
                <React.Fragment key={s.sessionId}>
                  {vi > 0 ? <Text color={colors.bone}>{rule(w)}</Text> : null}
                  <Box width={w} justifyContent="space-between">
                    <Text wrap="truncate-end">
                      <Text dimColor>{prefix}</Text>
                      <Text color={colors.bone}>{cell(s.title || "untitled", titleMax)}</Text>
                    </Text>
                    {liveTag ? <Text color={colors.ok}>{liveTag}</Text> : null}
                  </Box>
                </React.Fragment>
              );
            }

            // Age already shows in the left slot, so the meta line carries engine + device.
            const meta = [`${engine} ${s.cli}`, s.lastDevice?.label].filter(Boolean).join(" · ");
            return (
              <React.Fragment key={s.sessionId}>
                {vi > 0 ? <Text color={colors.bone}>{rule(w)}</Text> : null}
                <Text backgroundColor={colors.bone} bold>
                  <Text color={colors.ok}> ❯ </Text>
                  <Text color={colors.ink}>{cell(`${ageSlot}  ${s.title || "untitled"}`, Math.max(0, w - 3 - displayWidth(liveTag) - 1))}</Text>
                  <Text color={live ? colors.ok : colors.ink}>{liveTag ? `${liveTag} ` : ""}</Text>
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
      {/* The how-to row: keys read at full strength, verbs stay dim — the guidance has
          to survive next to the inverted selection without shouting over it. */}
      <Box justifyContent="space-between">
        <Text>
          <Text color={colors.bone} bold>↑↓</Text><Text dimColor> MOVE  </Text>
          <Text color={colors.ok} bold>↵</Text><Text dimColor> RESUME  </Text>
          <Text color={colors.bone} bold>F</Text><Text dimColor> FORK  </Text>
          <Text color={colors.bone} bold>D</Text><Text dimColor> DELETE  </Text>
          <Text color={colors.bone} bold>ESC</Text><Text dimColor> BACK</Text>
        </Text>
        <Text dimColor>{cloud ? `SYNC: ${cloud.toUpperCase()} ◉` : "LOCAL ONLY ○"}</Text>
      </Box>
      </Box>
    </Box>
  );
}
