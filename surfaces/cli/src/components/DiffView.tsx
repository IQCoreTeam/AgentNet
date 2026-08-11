import React from "react";
import { Box, Text } from "ink";
import { colors, diff as diffTheme } from "../theme.js";
import { padCells, wrapHard } from "../format.js";

// Shaded diff — added lines on a dark-green band, removed on dark-red, hunks dim violet,
// context dim. Lines are padded to a rectangle so the bands read as clean blocks; a header
// shows the +adds/−dels counts. The diff text is the engine's — we only tint + pad.
interface FileDiff {
  path: string;
  lines: string[];
}

function parseMultiFileDiff(diff: string): FileDiff[] {
  const lines = diff.split("\n");
  const files: FileDiff[] = [];
  let currentFile: FileDiff | null = null;

  for (const line of lines) {
    const gitMatch = line.match(/^diff --git a\/(.*) b\/(.*)$/);
    const indexMatch = line.match(/^Index: (.*)$/);
    const plusMatch = line.match(/^\+\+\+\s+b\/(.*)$/);
    const minusMatch = line.match(/^---\s+a\/(.*)$/);

    let detectedPath = "";
    if (gitMatch) detectedPath = gitMatch[2];
    else if (indexMatch) detectedPath = indexMatch[1];
    else if (plusMatch && (!currentFile || !currentFile.path)) detectedPath = plusMatch[1];
    else if (minusMatch && (!currentFile || !currentFile.path)) detectedPath = minusMatch[1];

    if (detectedPath && detectedPath !== "/dev/null") {
      currentFile = { path: detectedPath, lines: [] };
      files.push(currentFile);
    }

    if (currentFile) {
      currentFile.lines.push(line);
    } else {
      currentFile = { path: "Workspace Changes", lines: [line] };
      files.push(currentFile);
    }
  }

  return files.filter((f) => f.lines.length > 0);
}

// Shaded diff — added lines on a dark-green band, removed on dark-red, hunks dim violet,
// context dim. Lines are padded to a rectangle so the bands read as clean blocks; a header
// shows the +adds/−dels counts. The diff text is the engine's — we only tint + pad.
export function DiffView({
  diff,
  width,
  maxLines = 40,
  expanded = false,
  activeFileIdx = 0,
  interactive = true,
}: {
  diff: string;
  width: number; // cells available INSIDE whatever card is hosting the diff
  maxLines?: number;
  expanded?: boolean;
  activeFileIdx?: number;
  // false in the transcript, where there is no key handler listening: the summary must
  // not advertise a "[d]" that does nothing, and the diff shows itself instead of
  // hiding behind a toggle that can never be pressed.
  interactive?: boolean;
}) {
  const files = parseMultiFileDiff(diff);
  const fileDiff = files[activeFileIdx] || files[0] || { path: "Workspace Changes", lines: [] };
  const singleDiff = fileDiff.lines.join("\n");

  // Raw patch furniture (`diff --git`, `index`, `--- a/…`, `+++ b/…`) never appears in
  // the design's code box — the path already lives on the card header. Only change and
  // context lines render; @@ hunks stay as dim separators.
  const all = singleDiff
    .replace(/\s+$/, "")
    .split("\n")
    .filter(
      (l) =>
        !/^(diff --git |index [0-9a-f]+\.\.|Index: |=+$|--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to) |binary files )/i.test(l),
    );
  const totalAdds = files.reduce(
    (acc, f) => acc + f.lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length,
    0,
  );
  const totalDels = files.reduce(
    (acc, f) => acc + f.lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length,
    0,
  );

  // Wrap FIRST, then clamp, so `maxLines` is a budget of real screen rows. Clamping raw
  // diff lines and letting them wrap afterwards is how a "20 line" diff quietly became 35
  // rows and pushed the answer keys out of the frame.
  const bandW = Math.max(8, width);
  const rows: Array<{ text: string; raw: string }> = [];
  for (const raw of all) {
    // Keep the +/- marker in column 0 and give continuations a blank gutter, so a wrapped
    // line still reads as one change rather than as a new added/removed line.
    const prefix = raw.startsWith("+") || raw.startsWith("-") ? raw[0] : raw.slice(0, 1);
    const rest = raw.slice(1);
    const wrapped = wrapHard(rest, bandW - 1);
    for (let i = 0; i < wrapped.length; i++) {
      rows.push({ text: (i === 0 ? prefix : " ") + wrapped[i], raw });
    }
    if (rows.length > maxLines + 1) break;
  }
  const shownRows = rows.slice(0, maxLines);
  const hidden = all.length - new Set(shownRows.map((r) => r.raw)).size;

  if (!expanded) {
    return (
      <Box flexDirection="column" marginY={0}>
        <Text>
          <Text color={colors.ok}>+{totalAdds}</Text> <Text color={colors.err}>−{totalDels}</Text>
          <Text dimColor> lines changed across </Text>
          <Text color={colors.iqCyan} bold>{files.length}</Text>
          <Text dimColor> file{files.length === 1 ? "" : "s"}</Text>
          {interactive ? (
            <>
              <Text dimColor> (press </Text>
              <Text color={colors.iqCyan} bold>[d]</Text>
              <Text dimColor> to expand diff)</Text>
            </>
          ) : null}
        </Text>
      </Box>
    );
  }

  const tabs = files.map((f, idx) => {
    const isActive = idx === activeFileIdx;
    const label = `[${idx + 1}] ${f.path.split("/").pop() || f.path}`;
    return (
      <Text key={idx} color={isActive ? colors.iqCyan : colors.dim} bold={isActive}>
        {isActive ? ` ${label} ` : ` ${label} `}
      </Text>
    );
  });

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={colors.ok}>+{totalAdds}</Text> <Text color={colors.err}>−{totalDels}</Text>
        <Text dimColor> lines changed across </Text>
        <Text color={colors.iqCyan} bold>{files.length}</Text>
        <Text dimColor> file{files.length === 1 ? "" : "s"}</Text>
        {interactive ? (
          <>
            <Text dimColor> (press </Text>
            <Text color={colors.iqCyan} bold>[d]</Text>
            <Text dimColor> to collapse diff)</Text>
          </>
        ) : null}
      </Text>

      {files.length > 1 ? (
        <Box flexDirection="row" marginY={1}>
          <Text dimColor>Files: </Text>
          {tabs}
        </Box>
      ) : null}

      {shownRows.map((r, i) => (
        <HighlightDiffLine key={i} line={padCells(r.text, bandW)} raw={r.raw} />
      ))}
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
