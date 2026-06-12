import React from "react";
import { Box, Text } from "ink";
import { colors, diff as diffTheme } from "../theme.js";
import { padBlock } from "../format.js";

// Shaded diff — added lines on a dark-green band, removed on dark-red, hunks dim violet,
// context dim. Lines are padded to a rectangle so the bands read as clean blocks; a header
// shows the +adds/−dels counts. The diff text is the engine's — we only tint + pad.
export function DiffView({
  diff,
  maxLines = 40,
  expanded = false,
}: {
  diff: string;
  maxLines?: number;
  expanded?: boolean;
}) {
  const all = diff.replace(/\s+$/, "").split("\n");
  const adds = all.filter((l) => l.startsWith("+")).length;
  const dels = all.filter((l) => l.startsWith("-")).length;
  const shown = all.slice(0, maxLines);
  const hidden = all.length - shown.length;
  const { lines } = padBlock(shown);

  if (!expanded) {
    return (
      <Box flexDirection="column" marginY={0}>
        <Text>
          <Text color={colors.ok}>+{adds}</Text> <Text color={colors.err}>−{dels}</Text>
          <Text dimColor> lines changed (press </Text>
          <Text color={colors.iqCyan} bold>[d]</Text>
          <Text dimColor> to expand diff)</Text>
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={colors.ok}>+{adds}</Text> <Text color={colors.err}>−{dels}</Text>
        <Text dimColor> lines changed (press </Text>
        <Text color={colors.iqCyan} bold>[d]</Text>
        <Text dimColor> to collapse diff)</Text>
      </Text>
      {lines.map((line, i) => {
        const raw = shown[i];
        return <HighlightDiffLine key={i} line={line} raw={raw} />;
      })}
      {hidden > 0 ? <Text dimColor>⎿ +{hidden} more lines</Text> : null}
    </Box>
  );
}

function HighlightDiffLine({ line, raw }: { line: string; raw: string }) {
  if (raw.startsWith("@@")) {
    return <Text color={diffTheme.hunk}>{line}</Text>;
  }

  const isAdd = raw.startsWith("+");
  const isDel = raw.startsWith("-");
  const prefix = line[0] || "";
  const code = line.slice(1);

  const fg = isAdd ? diffTheme.addFg : isDel ? diffTheme.delFg : undefined;
  const bg = isAdd ? diffTheme.addBg : isDel ? diffTheme.delBg : undefined;

  if (!isAdd && !isDel) {
    return <Text dimColor>{line}</Text>;
  }

  // Basic regex tokenization for code keywords, strings, comments, numbers, booleans
  const tokens = code.split(
    /(\/\/.*|#.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|class|return|if|else|for|while|do|fn|def|import|export|from|true|false|null|undefined)\b|\d+)/,
  );

  const highlighted = tokens.map((token, idx) => {
    if (!token) return null;

    // Comments
    if (token.startsWith("//") || token.startsWith("#")) {
      return (
        <Text key={idx} color={colors.dim} dimColor>
          {token}
        </Text>
      );
    }
    // Strings
    if (token.startsWith('"') || token.startsWith("'") || token.startsWith("`")) {
      return (
        <Text key={idx} color={colors.warn}>
          {token}
        </Text>
      );
    }
    // Keywords
    if (
      /^(const|let|var|function|class|return|if|else|for|while|do|fn|def|import|export|from)$/.test(
        token,
      )
    ) {
      return (
        <Text key={idx} color={colors.iqMagenta} bold>
          {token}
        </Text>
      );
    }
    // Numbers & Booleans & Null
    if (/^(true|false|null|undefined|\d+)$/.test(token)) {
      return (
        <Text key={idx} color={colors.iqCyan}>
          {token}
        </Text>
      );
    }

    return (
      <Text key={idx} color={fg}>
        {token}
      </Text>
    );
  });

  return (
    <Text backgroundColor={bg}>
      <Text color={fg} bold>
        {prefix}
      </Text>
      {highlighted}
    </Text>
  );
}
