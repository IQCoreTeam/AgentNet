import React from "react";
import { Box, Text } from "ink";
import { colors, diff as diffTheme } from "../theme.js";
import { padBlock } from "../format.js";

// Shaded diff — added lines on a dark-green band, removed on dark-red, hunks dim violet,
// context dim. Lines are padded to a rectangle so the bands read as clean blocks; a header
// shows the +adds/−dels counts. The diff text is the engine's — we only tint + pad.
export function DiffView({ diff, maxLines = 40 }: { diff: string; maxLines?: number }) {
  const all = diff.replace(/\s+$/, "").split("\n");
  const adds = all.filter((l) => l.startsWith("+")).length;
  const dels = all.filter((l) => l.startsWith("-")).length;
  const shown = all.slice(0, maxLines);
  const hidden = all.length - shown.length;
  const { lines } = padBlock(shown);

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={colors.ok}>+{adds}</Text> <Text color={colors.err}>−{dels}</Text>
      </Text>
      {lines.map((line, i) => {
        const raw = shown[i];
        if (raw.startsWith("@@")) return <Text key={i} color={diffTheme.hunk}>{line}</Text>;
        if (raw.startsWith("+"))
          return <Text key={i} color={diffTheme.addFg} backgroundColor={diffTheme.addBg}>{line}</Text>;
        if (raw.startsWith("-"))
          return <Text key={i} color={diffTheme.delFg} backgroundColor={diffTheme.delBg}>{line}</Text>;
        return <Text key={i} dimColor>{line}</Text>;
      })}
      {hidden > 0 ? <Text dimColor>⎿ +{hidden} more lines</Text> : null}
    </Box>
  );
}
