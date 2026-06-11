import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { SessionMeta } from "@iqlabs-official/agent-sdk/runtime/contract";
import { colors, glyph, copy } from "../theme.js";

function ago(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Self-contained session picker: ↑/↓ move, ↵ resume, d delete, esc back. Built by hand
// (not @inkjs Select) so we can support inline delete on the highlighted row.
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
    if (key.upArrow) setIdx((i) => Math.max(0, i - 1));
    else if (key.downArrow) setIdx((i) => Math.min(sessions.length - 1, i + 1));
    else if (key.return) onResume(sessions[clamped].sessionId);
    else if (input === "d") onDelete(sessions[clamped].sessionId);
  });

  return (
    <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
      <Text bold color={colors.iqMagenta}>
        ❖ sessions
      </Text>
      {sessions.length === 0 ? (
        <Text dimColor>{copy.emptySessions}</Text>
      ) : (
        sessions.map((s, i) => {
          const on = i === clamped;
          const g = s.cli === "codex" ? glyph.codex : glyph.claude;
          const tint = s.cli === "codex" ? colors.codex : colors.claude;
          return (
            <Box key={s.sessionId}>
              <Text color={on ? colors.iqCyan : undefined}>{on ? "› " : "  "}</Text>
              <Text color={tint}>{g} </Text>
              <Text color={on ? colors.iqCyan : undefined}>
                {(s.title || "untitled").slice(0, 44).padEnd(44)}
              </Text>
              <Text dimColor> {ago(s.ts)}</Text>
              {s.sessionId === activeId ? <Text color={colors.ok}> ●</Text> : null}
            </Box>
          );
        })
      )}
      <Box marginTop={1}>
        <Text dimColor>↑/↓ move · ↵ resume · d delete · esc back</Text>
      </Box>
    </Box>
  );
}
