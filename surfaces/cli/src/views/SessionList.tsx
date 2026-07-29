import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { SessionMeta } from "@iqlabs-official/agent-sdk/runtime/contract";
import { colors, glyph, copy } from "../theme.js";
import { ChipCarousel } from "../components/ChipCarousel.js";

function ago(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const CHIP_W = 24;

// Session picker as a chip carousel: each session is a collectible chip, ←/→ rotates
// (the carousel windows to terminal width, so a big session pile never overflows the
// frame - overflow breaks scrolling AND leaves a stale frame ink can't erase).
// The carousel owns ←/→; this component keeps ↵ resume, d delete, esc back.
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
    <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
      <Text bold color={colors.iqMagenta}>
        ❖ sessions
      </Text>
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
              const tint = s.cli === "codex" ? colors.codex : colors.claude;
              return (
                <Box
                  flexDirection="column"
                  width={CHIP_W}
                  paddingX={1}
                  borderStyle="round"
                  borderColor={focused ? colors.iqCyan : colors.dim}
                >
                  <Box>
                    <Text color={tint}>{g} </Text>
                    <Text color={focused ? colors.iqCyan : undefined} bold={focused}>
                      {(s.title || "untitled").slice(0, CHIP_W - 6)}
                    </Text>
                  </Box>
                  <Box>
                    <Text dimColor>{ago(s.ts)}</Text>
                    {s.sessionId === activeId ? <Text color={colors.ok}> ●</Text> : null}
                  </Box>
                </Box>
              );
            }}
          />
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>←/→ move · ↵ resume · d delete · esc back</Text>
      </Box>
    </Box>
  );
}
