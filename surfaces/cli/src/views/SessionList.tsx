import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { SessionMeta } from "@iqlabs-official/agent-sdk/runtime/contract";
import { colors, copy, glyph, rule, tag } from "../theme.js";
import { displayWidth, padCells, truncateEnd } from "../format.js";

// Compact uppercase age, design-project style: 12S / 5M / 2H / 3D.
function age(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}S`;
  if (s < 3600) return `${Math.floor(s / 60)}M`;
  if (s < 86400) return `${Math.floor(s / 3600)}H`;
  return `${Math.floor(s / 86400)}D`;
}

// One source for the footer keys: the styled row and its width budget both read
// this list, so the hint can never advertise a key the row does not draw.
const FOOTER_KEYS: Array<[string, string]> = [
  ["↑↓", "MOVE"],
  ["↵", "RESUME"],
  ["F", "FORK"],
  ["D", "DELETE"],
  ["ESC", "BACK"],
];
const footerKeysPlain = FOOTER_KEYS.map(([k, v]) => `${k} ${v}`).join("  ");

// Session picker, tab 07 of the design: sessions STACK VERTICALLY, one row each behind
// bone rules. The selected row inverts edge to edge and grows a meta sub-line (age,
// engine, last device); the live session carries ● LIVE in green. Long lists window
// around the selection. ↑/↓ move, ↵ resume, f fork, d delete, esc back; the footer's
// right edge reports where sessions sync to. The whole thing renders as a bordered
// panel centered on a full-height wrapper, so opening it clears the visible screen
// (the chat survives in terminal scrollback) instead of stacking under it.
export function SessionList({
  sessions,
  error,
  activeId,
  cloud,
  onResume,
  onDelete,
  onFork,
  onClose,
}: {
  // null = the first listSessions has not settled: the body says loading, never the
  // "no sessions yet" empty copy, and the header count waits for a real number.
  sessions: SessionMeta[] | null;
  // a failed listSessions read (only shown when there is no settled list to render)
  error?: string | null;
  activeId?: string;
  cloud: string | null;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  onFork: (id: string) => void;
  onClose: () => void;
}) {
  const list = sessions ?? []; // mechanics treat pending as empty; render tells them apart
  const [idx, setIdx] = useState(0);
  const clamped = Math.min(idx, Math.max(0, list.length - 1));
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  // A framed panel floating on a cleared screen, not a full-bleed sheet: the wrapper
  // below fills the whole terminal, which pushes the chat into the terminal's own
  // scrollback (scroll up and it's all still there) and gives the picker real margins.
  // Never wider than the terminal: below 52 cols the old 44 floor pushed rows
  // past the frame and ate the right border.
  const totalW = Math.min(cols, Math.max(44, Math.min(cols - 8, 84)));
  const w = totalW - 4; // bold border (2) + paddingX(1) each side

  // Column budgets from the frame width. Meta drops whole before the title ever
  // starves - the title is the row's identity, so it keeps at least TITLE_MIN
  // cells and cuts with an ellipsis; the age column goes first, the live tag
  // only under ~25 cols. List-wide flags, so columns stay aligned across rows.
  const TITLE_MIN = 12;
  const liveW = displayWidth("● LIVE");
  const showAge = w - 8 - liveW - 1 >= TITLE_MIN; // 8 = "  " + age slot (4) + "  "
  const showLive = w - 2 - liveW - 1 >= TITLE_MIN;

  // Header and footer shrink the same way: the meta side goes first (encrypted
  // note, then the count; the sync label), the keys collapse to a plain
  // ellipsized row only when even they alone cannot fit.
  const headTag = tag("sessions");
  // the count is a claim about a settled list: while the fetch is pending the header
  // keeps ENCRYPTED alone instead of asserting "0 SESSIONS".
  const countLabel = sessions === null ? null : `${list.length} SESSION${list.length === 1 ? "" : "S"}`;
  const headRoom = w - displayWidth(headTag) - 2;
  const headNote =
    countLabel === null
      ? displayWidth("ENCRYPTED") <= headRoom
        ? "ENCRYPTED"
        : ""
      : displayWidth(`${countLabel} · ENCRYPTED`) <= headRoom
        ? `${countLabel} · ENCRYPTED`
        : displayWidth(countLabel) <= headRoom
          ? countLabel
          : "";
  const syncLabel = cloud ? `SYNC: ${cloud.toUpperCase()} ◉` : "LOCAL ONLY ○";
  const keysW = displayWidth(footerKeysPlain);
  const showSync = keysW + 2 + displayWidth(syncLabel) <= w;
  const styledKeys = keysW <= w;

  useInput((input, key) => {
    if (key.escape) return onClose();
    if (list.length === 0) return;
    if (key.upArrow) return setIdx(() => Math.max(0, clamped - 1));
    if (key.downArrow) return setIdx(() => Math.min(list.length - 1, clamped + 1));
    if (key.return) onResume(list[clamped].sessionId);
    else if (input === "f") onFork(list[clamped].sessionId);
    else if (input === "d") {
      onDelete(list[clamped].sessionId);
      setIdx((i) => Math.max(0, Math.min(i, list.length - 2)));
    }
  });

  // Window the list so the frame never outgrows the terminal: the selected row costs 2
  // rows + rule, the rest 1 + rule, plus the frame's chrome (border 2, paddingY 2,
  // header+rule 2, closing rule+footer 2, MORE indicators 2).
  const maxVisible = Math.max(3, Math.floor((rows - 13) / 2));
  const start = Math.min(Math.max(0, clamped - Math.floor(maxVisible / 2)), Math.max(0, list.length - maxVisible));
  const visible = list.slice(start, start + maxVisible);
  const above = start;
  const below = list.length - start - visible.length;

  return (
    <Box height={Math.max(10, rows - 1)} width={cols} justifyContent="center" alignItems="center">
      <Box flexDirection="column" width={totalW} borderStyle="bold" borderColor={colors.bone} paddingX={1} paddingY={1}>
      <Box justifyContent="space-between">
        <Text color={colors.bone} bold>{headTag}</Text>
        {headNote ? <Text dimColor>{headNote}</Text> : null}
      </Box>
      <Text color={colors.bone}>{rule(w)}</Text>

      {/* three honest states on the one reserved row: pending says loading, a read
          that failed with nothing to show says what failed, and the empty copy may
          only follow a SETTLED empty list. */}
      {sessions === null && error ? (
        <Text color={colors.err}>{truncateEnd(`could not load sessions · ${error}`, w)}</Text>
      ) : sessions === null ? (
        <Text dimColor>loading sessions…</Text>
      ) : list.length === 0 ? (
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
            const liveTag = live && showLive ? "● LIVE" : "";

            if (!focused) {
              const prefix = showAge ? `  ${ageSlot}  ` : "  ";
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
                      <Text color={colors.bone}>{padCells(truncateEnd(s.title || "untitled", titleMax), titleMax)}</Text>
                    </Text>
                    {liveTag ? <Text color={colors.ok}>{liveTag}</Text> : null}
                  </Box>
                </React.Fragment>
              );
            }

            // Age already shows in the left slot, so the meta line carries engine + device.
            const meta = [`${engine} ${s.cli}`, s.lastDevice?.label].filter(Boolean).join(" · ");
            const agePart = showAge ? `${ageSlot}  ` : "";
            const bodyW = Math.max(0, w - 3 - displayWidth(liveTag) - 1);
            const titleRoom = Math.max(1, bodyW - displayWidth(agePart));
            return (
              <React.Fragment key={s.sessionId}>
                {vi > 0 ? <Text color={colors.bone}>{rule(w)}</Text> : null}
                <Text backgroundColor={colors.bone} bold>
                  <Text color={colors.ok}> ❯ </Text>
                  <Text color={colors.ink}>{padCells(agePart + truncateEnd(s.title || "untitled", titleRoom), bodyW)}</Text>
                  <Text color={live ? colors.ok : colors.ink}>{liveTag ? `${liveTag} ` : ""}</Text>
                </Text>
                <Text backgroundColor={colors.bone} color={colors.ink}>
                  {padCells(truncateEnd(`${showAge ? "        " : "   "}${meta}`, w), w)}
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
        {styledKeys ? (
          <Text>
            {FOOTER_KEYS.map(([k, v], i) => (
              <React.Fragment key={k}>
                <Text color={k === "↵" ? colors.ok : colors.bone} bold>{k}</Text>
                <Text dimColor> {v}{i < FOOTER_KEYS.length - 1 ? "  " : ""}</Text>
              </React.Fragment>
            ))}
          </Text>
        ) : (
          <Text dimColor>{truncateEnd(footerKeysPlain, w)}</Text>
        )}
        {showSync ? <Text dimColor>{syncLabel}</Text> : null}
      </Box>
      </Box>
    </Box>
  );
}
