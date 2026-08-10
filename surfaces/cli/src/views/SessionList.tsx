import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { SessionMeta } from "@iqlabs-official/agent-sdk/runtime/contract";
import { colors, glyph, copy, rule, tag } from "../theme.js";
import { ChipCarousel } from "../components/ChipCarousel.js";
import { displayWidth } from "../format.js";

// Compact uppercase age, design-project style: 12S / 5M / 2H / 3D.
function age(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}S`;
  if (s < 3600) return `${Math.floor(s / 60)}M`;
  if (s < 86400) return `${Math.floor(s / 3600)}H`;
  return `${Math.floor(s / 86400)}D`;
}

// Pad/trim a string to an exact CELL width (Hangul/CJK count 2) so the inverted card
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

// Deterministic dither texture per session — the card art from the design project,
// derived from the session id so it's stable across renders (no Math.random flicker).
function dither(id: string): [string, string] {
  const shades = "░▒▓";
  const dots = " ⠂⠈⡀⠐";
  let a = "";
  let b = " ";
  for (let i = 0; i < 12; i++) {
    const c = (id.charCodeAt(i % id.length) || 42) + i;
    a += i % 4 === 3 ? dots[c % dots.length] : shades[c % shades.length];
    b += i % 3 === 2 ? dots[(c >> 1) % dots.length] : shades[(c >> 2) % shades.length];
  }
  return [a, b];
}

const CHIP_W = 26;
const INNER_W = CHIP_W - 4; // border + paddingX on both sides

// Session picker as a card rail: S.01-numbered cards, ←/→ moves, and the focused card
// INVERTS (ink on bone) — the design project's strongest signature. The carousel owns
// ←/→; this component keeps ↵ resume, d delete, esc back.
export function SessionList({
  sessions,
  activeId,
  onResume,
  onDelete,
  onClose,
}: {
  sessions: SessionMeta[];
  activeId?: string;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const clamped = Math.min(idx, Math.max(0, sessions.length - 1));
  const ruleW = Math.max(0, (process.stdout.columns || 80) - 2);

  useInput((input, key) => {
    if (key.escape) return onClose();
    if (sessions.length === 0) return;
    if (key.return) onResume(sessions[clamped].sessionId);
    else if (input === "d") {
      onDelete(sessions[clamped].sessionId);
      setIdx((i) => Math.max(0, Math.min(i, sessions.length - 2)));
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text color={colors.bone} bold>{tag("sessions")}</Text>
        <Text dimColor>{sessions.length} SESSION{sessions.length === 1 ? "" : "S"} · ENCRYPTED</Text>
      </Box>
      <Text color={colors.bone}>{rule(ruleW)}</Text>
      {sessions.length === 0 ? (
        <Text dimColor>{copy.emptySessions}</Text>
      ) : (
        <Box marginTop={1}>
          <ChipCarousel
            items={sessions}
            index={clamped}
            onIndex={setIdx}
            chipWidth={CHIP_W}
            renderChip={(s, focused) => {
              const g = s.cli === "codex" ? glyph.codex : glyph.claude;
              const n = String(sessions.indexOf(s) + 1).padStart(2, "0");
              const live = s.sessionId === activeId;
              const fg = focused ? colors.ink : undefined;
              const bg = focused ? colors.bone : undefined;
              const dim = focused ? colors.ink : colors.dim;
              const [d1, d2] = dither(s.sessionId);
              return (
                <Box
                  flexDirection="column"
                  width={CHIP_W}
                  paddingX={1}
                  borderStyle="bold"
                  borderColor={focused ? colors.bone : colors.dim}
                >
                  <Text backgroundColor={bg} color={dim}>
                    {cell(`S.${n} ${g} ${s.cli.toUpperCase()}${live ? " ●" : ""}`, INNER_W)}
                  </Text>
                  <Text backgroundColor={bg} color={fg} bold>
                    {cell(s.title || "untitled", INNER_W)}
                  </Text>
                  <Text backgroundColor={bg} color={dim}>{cell(d1, INNER_W)}</Text>
                  <Text backgroundColor={bg} color={dim}>{cell(d2, INNER_W)}</Text>
                  <Text backgroundColor={bg} color={dim}>
                    {cell(`${tag("age")} ${age(s.ts)}`, INNER_W)}
                  </Text>
                </Box>
              );
            }}
          />
        </Box>
      )}
      <Text color={colors.bone}>{rule(ruleW)}</Text>
      <Text dimColor>←/→ MOVE · ↵ RESUME · D DELETE · ESC BACK</Text>
    </Box>
  );
}
