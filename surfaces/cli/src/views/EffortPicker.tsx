import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { findChatModelOption, modelEffortOptions } from "@iqlabs-official/agent-sdk/chat/modelOptions";
import { loadModelOptions } from "../models.js";
import type { EngineKey } from "@iqlabs-official/agent-sdk";
import type { EffortLevel } from "../prefs.js";
import { colors, tag } from "../theme.js";

export function EffortPicker({
  cli,
  model,
  current,
  onPick,
  onClose,
}: {
  cli: EngineKey;
  model?: string;
  current?: EffortLevel;
  onPick: (value?: EffortLevel) => void;
  onClose: () => void;
}) {
  const [opts, setOpts] = useState([{ label: "default", value: undefined as string | undefined, hint: "engine default" }]);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    let active = true;
    setOpts([{ label: "default", value: undefined, hint: "engine default" }]);
    setIdx(0);
    void loadModelOptions(cli).then(models => {
      if (!active) return;
      const selected = findChatModelOption(models, model);
      const options = modelEffortOptions(selected).map(o => ({
        label: o.label,
        value: o.value === "default" ? undefined : o.value,
        hint: o.value === "default" ? "engine default" : "",
      }));
      setOpts(options);
      setIdx(Math.max(0, options.findIndex(o => o.value === current)));
    });
    return () => { active = false; };
  }, [cli, model, current]);

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
        {tag("effort")} REASONING DEPTH
      </Text>
      {opts.map((o, i) => {
        const on = i === safeIdx;
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
        <Text dimColor>↑/↓ MOVE · ↵ SELECT · ESC CANCEL</Text>
      </Box>
    </Box>
  );
}
