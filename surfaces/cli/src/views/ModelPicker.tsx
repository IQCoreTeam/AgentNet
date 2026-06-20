import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { MODELS } from "../models.js";
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
  const opts = MODELS[cli];
  const [idx, setIdx] = useState(Math.max(0, opts.findIndex((o) => o.value === current)));

  useInput((_i, key) => {
    if (key.escape) return onClose();
    if (key.upArrow) setIdx((i) => Math.max(0, i - 1));
    else if (key.downArrow) setIdx((i) => Math.min(opts.length - 1, i + 1));
    else if (key.return) onPick(opts[idx].value);
  });

  return (
    <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
      <Text bold color={colors.iqMagenta}>
        ❖ model · {cli}
      </Text>
      {opts.map((o, i) => {
        const on = i === idx;
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
