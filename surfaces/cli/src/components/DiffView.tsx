import React from "react";
import { Box, Text } from "ink";
import { colors, diff as diffTheme } from "../theme.js";
import { padCells, wrapHard, displayWidth } from "../format.js";

// How many files a diff carries — the ONE parse both this component and a hosting card's
// row budget read, so "will the Files strip render?" can never disagree with whether it
// does. A multi-file diff costs the strip's one row; the host subtracts it from the
// content budget it passes as maxLines.
export function diffFileCount(diff: string): number {
  return parseMultiFileDiff(diff).length;
}

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
  summary = true,
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
  // false when the host already carries the +adds/−dels (a CodeBox title band):
  // the counts row would say it twice.
  summary?: boolean;
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

  // Hunk headers give us real line numbers, so the box can carry a dim number gutter the
  // way an edit block does in chat: deletions numbered from the old file, additions and
  // context from the new. The raw @@ row itself renders as a dim ⋯ separator between
  // hunks — the numbers already say where we are.
  const numbered: Array<
    { raw: string; ln: number; idx: number; sep?: false } | { raw: string; sep: true }
  > = [];
  let oldLn = 0;
  let newLn = 0;
  let hasHunks = false;
  for (const raw of all) {
    const h = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) {
      hasHunks = true;
      oldLn = Number(h[1]);
      newLn = Number(h[2]);
      if (numbered.length > 0) numbered.push({ raw, sep: true });
      continue;
    }
    const idx = numbered.length;
    if (raw.startsWith("+")) numbered.push({ raw, ln: newLn++, idx });
    else if (raw.startsWith("-")) numbered.push({ raw, ln: oldLn++, idx });
    else {
      numbered.push({ raw, ln: newLn++, idx });
      oldLn++;
    }
  }
  const gutterW = hasHunks
    ? Math.max(2, ...numbered.map((e) => (e.sep ? 0 : String(e.ln).length)))
    : 0;

  // Wrap FIRST, then clamp, so `maxLines` is a budget of real screen rows. Clamping raw
  // diff lines and letting them wrap afterwards is how a "20 line" diff quietly became 35
  // rows and pushed the answer keys out of the frame.
  const bandW = Math.max(8, width - (gutterW ? gutterW + 1 : 0));
  const rows: Array<{ text: string; raw: string; gutter: string; idx: number }> = [];
  for (const entry of numbered) {
    if (entry.sep) {
      rows.push({ text: "", raw: entry.raw, gutter: "", idx: -1 });
      continue;
    }
    const { raw, ln, idx } = entry;
    // Keep the +/- marker in column 0 and give continuations a blank gutter, so a wrapped
    // line still reads as one change rather than as a new added/removed line.
    const prefix = raw.startsWith("+") || raw.startsWith("-") ? raw[0] : raw.slice(0, 1);
    const rest = raw.slice(1);
    const wrapped = wrapHard(rest, bandW - 1);
    for (let i = 0; i < wrapped.length; i++) {
      rows.push({
        text: (i === 0 ? prefix : " ") + wrapped[i],
        raw,
        idx,
        gutter: gutterW ? (i === 0 ? String(ln).padStart(gutterW) : " ".repeat(gutterW)) : "",
      });
    }
    if (rows.length > maxLines + 1) break;
  }
  const shownRows = rows.slice(0, maxLines);
  // Hidden = CONTENT lines not on screen. Counting raw @@ furniture here is how the box
  // once claimed "+1 more lines" while every real line was visible.
  const contentTotal = numbered.filter((e) => !e.sep).length;
  const hidden = contentTotal - new Set(shownRows.filter((r) => r.idx >= 0).map((r) => r.idx)).size;

  // The summary is ONE row by contract - the hosting card counts it as one when it
  // budgets rows - but its full sentence is wider than a narrow terminal, and a wrap
  // here silently makes the card 2 rows taller than the count. truncate-end keeps the
  // row honest; the counts at the head are the part that must survive.
  if (!expanded) {
    return (
      <Box flexDirection="column" marginY={0}>
        <Text wrap="truncate-end">
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

  // The Files strip is ONE row by contract — the same contract the summary row keeps —
  // because the hosting card counts it as one when it budgets rows. It used to be a
  // marginY={1} Box whose tabs wrapped at narrow widths: 3 uncounted rows (blank, wrap,
  // blank) that pushed the approval frame past a 40x24 terminal into the repaint storm.
  // Now: no margins, one Text with truncate-end. The window below slides the visible
  // tabs so the ACTIVE one always fits (a leading … marks what slid off); tabs past the
  // right edge are cut by the truncation. Switching keys live in the host and are
  // untouched — every file still renders when picked, its tab is just guaranteed a seat.
  const tabLabels = files.map((f, idx) => ` [${idx + 1}] ${f.path.split("/").pop() || f.path} `);
  let tabStart = 0;
  {
    const avail = width - displayWidth("Files: ") - 1; // 1 for the leading … marker
    while (
      tabStart < activeFileIdx &&
      tabLabels.slice(tabStart, activeFileIdx + 1).reduce((n, s) => n + displayWidth(s), 0) > avail
    )
      tabStart++;
  }

  return (
    <Box flexDirection="column">
      {summary ? (
        // same one-row contract as the collapsed summary above
        <Text wrap="truncate-end">
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
      ) : null}

      {files.length > 1 ? (
        <Box>
          <Text wrap="truncate-end">
            <Text dimColor>Files: </Text>
            {tabStart > 0 ? <Text dimColor>…</Text> : null}
            {tabLabels.slice(tabStart).map((label, i) => {
              const idx = tabStart + i;
              const isActive = idx === activeFileIdx;
              return (
                <Text key={idx} color={isActive ? colors.iqCyan : colors.dim} bold={isActive}>
                  {label}
                </Text>
              );
            })}
          </Text>
        </Box>
      ) : null}

      {shownRows.map((r, i) =>
        r.raw.startsWith("@@") && !r.text ? (
          <Text key={i} color={diffTheme.hunk}>{`${" ".repeat(gutterW)} ⋯`}</Text>
        ) : (
          <Box key={i} flexDirection="row">
            {gutterW ? <Text dimColor>{r.gutter} </Text> : null}
            <HighlightDiffLine line={padCells(r.text, bandW)} raw={r.raw} />
          </Box>
        ),
      )}
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

  if (!isAdd && !isDel) {
    return <Text dimColor>{line}</Text>;
  }

  // One uniform colour per changed line, the design's own treatment: soft green on the
  // dark green band, soft red on the dark red band. Token-level syntax colours used to
  // paint numbers green INSIDE a deletion — a green token on the red band muddied the
  // one signal a diff exists to give.
  const fg = isAdd ? diffTheme.addFg : diffTheme.delFg;
  const bg = isAdd ? diffTheme.addBg : diffTheme.delBg;
  return (
    <Text backgroundColor={bg} color={fg}>
      <Text bold>{line[0] || ""}</Text>
      {line.slice(1)}
    </Text>
  );
}
