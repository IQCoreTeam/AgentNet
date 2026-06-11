import React from "react";
import { Box, Text } from "ink";
import type { ApprovalRequest } from "@iqlabs-official/agent-sdk/runtime/approval/channel";
import { colors, glyph } from "../theme.js";
import { DiffView } from "./DiffView.js";

// A calm question, not an alarm — but the exact command/diff/file is shown verbatim so
// the user decides on real information. Keys (y/a/n) are handled by the parent's useInput.
export function ApprovalCard({ req }: { req: ApprovalRequest }) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={colors.warn}
      paddingX={1}
      marginTop={1}
    >
      <Text color={colors.warn} bold>
        {glyph.thinking} {req.cli} wants to use {req.tool}
      </Text>
      <Text>{req.title}</Text>
      {req.command ? <Text color={colors.iqCyan}>$ {req.command}</Text> : null}
      {req.file ? <Text dimColor>{req.file}</Text> : null}
      {req.diff ? <DiffView diff={req.diff} maxLines={20} /> : null}
      <Box marginTop={1}>
        <Text color={colors.ok}>[y]</Text>
        <Text> allow once  </Text>
        <Text color={colors.iqMagenta}>[a]</Text>
        <Text> always  </Text>
        <Text color={colors.err}>[n]</Text>
        <Text> deny</Text>
      </Box>
    </Box>
  );
}
