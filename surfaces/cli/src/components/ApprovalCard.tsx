import React from "react";
import { Box, Text } from "ink";
import type { ApprovalRequest } from "@iqlabs-official/agent-sdk/runtime/approval/channel";
import { colors, glyph } from "../theme.js";
import { DiffView } from "./DiffView.js";

// A calm question, not an alarm — UNLESS the action is flagged risky, then we alarm on
// purpose (red border + warning). The exact command/diff/file is shown verbatim so the
// user decides on real information. Keys (y/a/n/r/e) are handled by the parent's useInput.
//   reply == "reason" → typing a deny reason (fed back to the model)
//   reply == "edit"   → editing the bash command before allowing it
export function ApprovalCard({
  req,
  reply = null,
  replyText = "",
  diffExpanded = false,
  activeDiffFileIdx = 0,
  maxRows = 12,
}: {
  req: ApprovalRequest;
  reply?: "reason" | "edit" | null;
  replyText?: string;
  diffExpanded?: boolean;
  activeDiffFileIdx?: number;
  maxRows?: number; // rows the frame can give this band before it clips
}) {
  const danger = req.risk === "danger";
  const accent = danger ? colors.err : colors.warn;
  const canEdit = req.kind === "bash";
  // corner focus marks (ㄱ top-right / ㄴ bottom-left), same language as the composer —
  // this card takes the composer's slot, so it wears the same frame. Danger doubles the
  // corner strokes where the calm card uses single lines.
  const cols = process.stdout.columns || 80;
  const cornerTop = " ".repeat(Math.max(0, cols - 5)) + (danger ? "══╗" : "──┐");
  const cornerBottom = danger ? "╚══" : "└──";

  // This card takes the composer's slot inside a FIXED-HEIGHT frame, so anything it
  // renders past `maxRows` is not scrolled — it is clipped away, bottom-first. The
  // bottom is where the [y]/[a]/[n] keys live, so an unbounded card silently eats its
  // own answer row and the prompt reads as a truncated blob you can't act on. Budget the
  // rows: the question and the keys are fixed cost, the diff gets whatever is left.
  const showCwd = req.kind === "bash" && Boolean(req.cwd);
  const fixedRows =
    1 + // marginTop
    1 + // corner top
    1 + // "<cli> wants to use <tool>"
    1 + // title
    (req.command ? 1 : 0) +
    (showCwd ? 1 : 0) +
    (req.file ? 1 : 0) +
    (reply ? 4 : 2) + // reply editor (margin+label+input+hint) or margin+keys row
    1; // corner bottom
  const diffRows = Math.max(0, maxRows - fixedRows);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={accent}>{cornerTop}</Text>
      <Text color={accent} bold wrap="truncate-end">
        {danger ? "⚠ DANGER · " : `${glyph.thinking} `}
        {req.cli} wants to use {req.tool}
      </Text>
      <Text wrap="truncate-end">{req.title}</Text>
      {req.command ? <Text color={colors.iqCyan} wrap="truncate-end">$ {req.command}</Text> : null}
      {showCwd ? <Text dimColor wrap="truncate-end">in {req.cwd}</Text> : null}
      {req.file ? <Text dimColor wrap="truncate-end">{req.file}</Text> : null}
      {req.diff && diffRows >= 3 ? (
        <DiffView
          diff={req.diff}
          // an expanded diff adds a tab row + a "N more lines" row on top of its lines
          maxLines={Math.max(1, diffRows - 2)}
          expanded={diffExpanded}
          activeFileIdx={activeDiffFileIdx}
        />
      ) : req.diff && diffRows >= 1 ? (
        <Text dimColor wrap="truncate-end">(diff hidden - terminal too short)</Text>
      ) : null}

      {reply ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={accent}>
            {reply === "reason" ? "deny: tell the model why:" : "edit command, then ↵ to run:"}
          </Text>
          <Box>
            <Text color={colors.iqCyan}>❯ </Text>
            <Text>
              {replyText}
              <Text inverse> </Text>
            </Text>
          </Box>
          <Text dimColor>↵ submit · esc back</Text>
        </Box>
      ) : (
        <Box marginTop={1} flexWrap="wrap">
          <Text color={colors.ok}>[y]</Text>
          <Text> allow once  </Text>
          <Text color={colors.iqMagenta}>[a]</Text>
          <Text> always  </Text>
          <Text color={colors.err}>[n]</Text>
          <Text> deny  </Text>
          <Text color={colors.iqViolet}>[r]</Text>
          <Text> deny+reason  </Text>
          {req.diff ? (
            <>
              <Text color={colors.iqCyan}>[d]</Text>
              <Text> toggle diff  </Text>
            </>
          ) : null}
          {canEdit ? (
            <>
              <Text color={colors.iqCyan}>[e]</Text>
              <Text> edit</Text>
            </>
          ) : null}
        </Box>
      )}
      <Text color={accent}>{cornerBottom}</Text>
    </Box>
  );
}
