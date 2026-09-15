import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { EngineKey } from "@iqlabs-official/agent-sdk";
import { MODELS, loadModelOptions } from "../models.js";
import { colors, rule } from "../theme.js";
import { displayWidth } from "../format.js";

// The design's model picker (tab 06): a bone frame titled PICK A MODEL with the live
// model on the right in green, split into a list (selected row inverted edge to edge,
// green ❯, CURRENT marking the active model) and a WHAT THIS ONE IS side panel behind
// a bold rail that explains the focused option. The side panel's bottom caption says
// where the list came from — the installed CLI's live catalog, or the built-in
// baseline while the probe is still out. ↑/↓ + ↵, esc cancels; picking the option
// whose value is undefined clears the override.
export function ModelPicker({
  cli,
  current,
  onPick,
  onClose,
}: {
  cli: EngineKey;
  current?: string;
  onPick: (value?: string) => void;
  onClose: () => void;
}) {
  // Show the static baseline instantly, then upgrade to the live CLI catalog when it
  // arrives (a new model like a fresh Sonnet appears with no code change here).
  const [opts, setOpts] = useState(MODELS[cli]);
  const [live, setLive] = useState(false);
  useEffect(() => {
    let alive = true;
    setOpts(MODELS[cli]);
    setLive(false);
    loadModelOptions(cli).then((catalog) => {
      if (!alive) return;
      setOpts(catalog);
      setLive(true);
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

  const cols = process.stdout.columns || 80;
  const totalW = Math.max(44, Math.min(cols - 4, 96));
  const innerW = totalW - 2; // inside the bone border
  // The side panel needs room to say anything; below that the description moves under
  // the list instead (the design's 330px cell has no meaning at 50 cells).
  const sideW = innerW >= 64 ? Math.min(38, Math.floor(innerW * 0.42)) : 0;
  const listW = innerW - sideW;

  const isCurrent = (o: { value?: string }) => o.value === current || (!o.value && !current);
  const currentLabel = (opts.find(isCurrent)?.label ?? "default").toUpperCase();
  const focusedDesc = opts[safeIdx]?.description ?? "";
  const sourceCaption = live ? "READ FROM THE INSTALLED CLI" : "BUILT-IN LIST · READING CLI…";

  return (
    <Box flexDirection="column" width={totalW} borderStyle="bold" borderColor={colors.bone}>
      <Box width={innerW} justifyContent="space-between" paddingX={1}>
        <Text bold color={colors.bone}>PICK A MODEL</Text>
        <Text color={colors.ok}>NOW · {currentLabel}</Text>
      </Box>
      <Text color={colors.bone}>{rule(innerW)}</Text>

      <Box flexDirection="row">
        <Box flexDirection="column" width={listW}>
          {opts.map((o, i) => {
            const marker = isCurrent(o) ? "CURRENT " : "";
            if (i === safeIdx) {
              const left = ` ❯ ${o.label}`;
              const gap = Math.max(1, listW - displayWidth(left) - displayWidth(marker));
              return (
                <Text key={o.value ?? "default"} backgroundColor={colors.bone} bold>
                  <Text color={colors.ok}> ❯ </Text>
                  <Text color={colors.ink}>{o.label + " ".repeat(gap) + marker}</Text>
                </Text>
              );
            }
            return (
              <Box key={o.value ?? "default"} width={listW} justifyContent="space-between">
                <Text dimColor>{`   ${o.label}`}</Text>
                <Text dimColor>{marker}</Text>
              </Box>
            );
          })}
        </Box>

        {sideW > 0 ? (
          <Box
            flexDirection="column"
            width={sideW}
            borderStyle="bold"
            borderColor={colors.bone}
            borderTop={false}
            borderRight={false}
            borderBottom={false}
            paddingX={1}
          >
            <Text dimColor>WHAT THIS ONE IS</Text>
            <Text>{focusedDesc}</Text>
            <Box marginTop={1}>
              <Text dimColor>{sourceCaption}</Text>
            </Box>
          </Box>
        ) : null}
      </Box>

      {sideW === 0 && focusedDesc ? (
        <Box width={innerW} paddingX={1} marginTop={1}>
          <Text dimColor>{focusedDesc}</Text>
        </Box>
      ) : null}

      <Text color={colors.bone}>{rule(innerW)}</Text>
      <Box paddingX={1}>
        <Text dimColor>↑/↓ MOVE · ↵ SELECT · ESC CANCEL</Text>
      </Box>
    </Box>
  );
}
