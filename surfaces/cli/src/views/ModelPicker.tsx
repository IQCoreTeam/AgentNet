import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { MODELS, loadModelOptions } from "../models.js";
import { colors } from "../theme.js";

// Pick a model for the current engine (↑/↓ + ↵, esc cancels). Built by hand to match the
// SessionList look and show the per-option hint. value undefined = clear the override.
export function ModelPicker({
  cli,
  current,
  onPick,
  onClose,
}: {
  cli: "claude" | "codex";
  current?: string;
  onPick: (value?: string) => void;
  onClose: () => void;
}) {
  // Show the static baseline instantly, then upgrade to the live CLI catalog when it
  // arrives (a new model like a fresh Sonnet appears with no code change here).
  const [opts, setOpts] = useState(MODELS[cli]);
  useEffect(() => {
    let alive = true;
    setOpts(MODELS[cli]);
    loadModelOptions(cli).then((live) => {
      if (alive) setOpts(live);
    });
    return () => {
      alive = false;
    };
  }, [cli]);
  const [idx, setIdx] = useState(Math.max(0, MODELS[cli].findIndex((o) => o.value === current)));

  // opts can shrink/grow when the live catalog replaces the baseline; keep idx in range.
  const safeIdx = Math.min(idx, opts.length - 1);
  useInput((_i, key) => {
    if (key.escape) return onClose();
    if (key.upArrow) setIdx((i) => Math.max(0, Math.min(i, opts.length - 1) - 1));
    else if (key.downArrow) setIdx((i) => Math.min(opts.length - 1, i + 1));
    else if (key.return) onPick(opts[safeIdx]?.value);
  });

  return (
    <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
      <Text bold color={colors.iqMagenta}>
        ❖ model · {cli}
      </Text>
      {opts.map((o, i) => {
        const on = i === safeIdx;
        const value = o.value;
        return (
          <Box key={o.value ?? "default"}>
            <Text color={on ? colors.iqCyan : undefined}>{on ? "› " : "  "}</Text>
            <Text color={on ? colors.iqCyan : undefined} bold={on}>
              {o.label.padEnd(16)}
            </Text>
            <Text dimColor>{o.description}</Text>
            {value === current || (!value && !current) ? <Text color={colors.ok}> ●</Text> : null}
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>↑/↓ · ↵ select · esc cancel</Text>
      </Box>
    </Box>
  );
}
