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
}: {
  req: ApprovalRequest;
  reply?: "reason" | "edit" | null;
  replyText?: string;
  diffExpanded?: boolean;
}) {
  const danger = req.risk === "danger";
  const accent = danger ? colors.err : colors.warn;
  const canEdit = req.kind === "bash";
  return (
    <Box
      flexDirection="column"
      borderStyle={danger ? "double" : "round"}
      borderColor={accent}
      paddingX={1}
      marginTop={1}
    >
      <Text color={accent} bold>
        {danger ? "⚠ DANGER — " : `${glyph.thinking} `}
        {req.cli} wants to use {req.tool}
      </Text>
      <Text>{req.title}</Text>
      {req.command ? <Text color={colors.iqCyan}>$ {req.command}</Text> : null}
      {req.kind === "bash" && req.cwd ? <Text dimColor>in {req.cwd}</Text> : null}
      {req.file ? <Text dimColor>{req.file}</Text> : null}
      {req.diff ? <DiffView diff={req.diff} maxLines={20} expanded={diffExpanded} /> : null}

      {reply ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={accent}>
            {reply === "reason" ? "deny — tell the model why:" : "edit command, then ↵ to run:"}
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
    </Box>
  );
}
