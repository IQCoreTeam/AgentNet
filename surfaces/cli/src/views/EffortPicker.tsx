import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { EffortLevel } from "../prefs.js";
import { colors } from "../theme.js";

const EFFORTS: { label: EffortLevel; hint: string }[] = [
  { label: "low",    hint: "minimal thinking, fastest" },
  { label: "medium", hint: "moderate reasoning" },
  { label: "high",   hint: "deeper thinking" },
  { label: "xhigh",  hint: "extended reasoning" },
  { label: "max",    hint: "maximum effort (select models)" },
];

export function EffortPicker({
  current,
  onPick,
  onClose,
}: {
  current?: EffortLevel;
  onPick: (value?: EffortLevel) => void;
  onClose: () => void;
}) {
  // include a "default" (clear) entry at index 0
  const opts: Array<{ label: string; value?: EffortLevel; hint: string }> = [
    { label: "default", value: undefined, hint: "engine default" },
    ...EFFORTS,
  ];
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
        ❖ effort · reasoning depth
      </Text>
      {opts.map((o, i) => {
        const on = i === idx;
        return (
          <Box key={o.label}>
            <Text color={on ? colors.iqCyan : undefined}>{on ? "› " : "  "}</Text>
            <Text color={on ? colors.iqCyan : undefined} bold={on}>
              {o.label.padEnd(10)}
            </Text>
            <Text dimColor>{o.hint}</Text>
            {o.value === current ? <Text color={colors.ok}> ●</Text> : null}
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>↑/↓ · ↵ select · esc cancel</Text>
      </Box>
    </Box>
  );
}
