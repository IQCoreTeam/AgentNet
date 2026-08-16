import React from "react";
import { Box, Text } from "ink";
import { highlight } from "cli-highlight";
import { basename, extname } from "node:path";
import type { ToolAction } from "@iqlabs-official/agent-sdk/runtime/contract";
import { glyph, toolTint, colors, surface } from "../theme.js";
import { TodoPanel } from "./TodoPanel.js";
import { DiffView } from "./DiffView.js";
import { stripAnsi, clampLines, lineCount, wrapBlock, displayWidth, truncateStart } from "../format.js";

const MAX_OUTPUT_LINES = 12;

// Cells the card's contents get to use. The transcript renders inside ink's <Static>,
// whose box is position:absolute and therefore sizes to its CONTENT, not to the
// terminal — so one unbreakable stack-trace path made the whole block wider than the
// screen and the terminal wrapped the overflow back to column 0, dumping fragments
// outside the border. Fixing that needs BOTH halves: an explicit width (Chat sets it on
// the Static item) so the box cannot measure wide, and hard-wrapped text here so no
// single token can exceed that width in the first place.
function cardWidth(): { card: number; inner: number } {
  const cols = process.stdout.columns || 80;
  const card = Math.max(24, cols - 3); // frame paddingX(2) + this card's marginLeft(1)
  return { card, inner: Math.max(12, card - 4) }; // border(2) + paddingX(2)
}

// Extension → cli-highlight language name.
const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript",
  mjs: "javascript", cjs: "javascript",
  json: "json", json5: "json",
  py: "python",
  rs: "rust",
  go: "go",
  sh: "bash", bash: "bash", zsh: "bash",
  css: "css", scss: "css",
  html: "html",
  md: "markdown",
  yaml: "yaml", yml: "yaml",
  toml: "toml",
  sql: "sql",
};

function langFor(file?: string): string | undefined {
  if (!file) return undefined;
  return EXT_LANG[extname(file).replace(".", "").toLowerCase()];
}

// Shorten path: keep last 2 segments so it reads without being huge.
function shortPath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : p;
}

// Map an engine tool name to our render kind (and its tint/glyph).
function kindOf(name: string): keyof typeof toolTint {
  const n = name.toLowerCase();
  if (n.includes("bash") || n.includes("command") || n.includes("exec")) return "bash";
  if (n.includes("edit") || n.includes("patch")) return "edit";
  if (n.includes("write")) return "write";
  if (n.includes("read")) return "read";
  if (n.includes("agent") || n.includes("task")) return "agent";
  return "other";
}

// The design's `.code` box (tab 09): a 1px #2a2a28 border around anything that is code —
// the EDIT diff and the BASH command with its output. The #101013 background reads as
// near-nothing over the terminal, so in cells the BORDER is the silhouette; long lines
// hard-wrap inside because a terminal has no horizontal scroll. Nothing leaves the frame.
// `header` renders as a full-bleed title band (bg = the border's own #2a2a28) — the
// file's title bar, the way a code block in chat carries its filename on top.
function CodeBox({
  width,
  header,
  children,
}: {
  width: number;
  header?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="single"
      borderColor={surface.pastHeader}
    >
      {header}
      <Box flexDirection="column" paddingX={1}>
        {children}
      </Box>
    </Box>
  );
}

// Output block: syntax-highlighted when a language is known, else plain.
// Clamped to MAX_OUTPUT_LINES; fold note shows hidden count.
// `bare` drops the "⎿ " gutter when a CodeBox border already carries the attachment.
function Output({
  text,
  failed,
  lang,
  width,
  bare = false,
}: {
  text: string;
  failed?: boolean;
  lang?: string;
  width: number;
  bare?: boolean;
}) {
  const clean = stripAnsi(text);
  const { shown, hidden } = clampLines(clean, MAX_OUTPUT_LINES);
  if (!shown.trim()) return null;

  // Wrap BEFORE highlighting: highlight() inserts ANSI escapes that carry no display
  // width, so wrapping afterwards would count them as characters and cut the rows short.
  // Wrapping first also keeps the highlighter's own line-by-line context intact, because
  // the wrapped rows are rejoined with newlines before it runs.
  const wrapped = wrapBlock(shown, Math.max(8, width)).join("\n");

  let highlighted = wrapped;
  if (lang && !failed) {
    try {
      highlighted = highlight(wrapped, { language: lang, ignoreIllegals: true });
    } catch { /* keep plain */ }
  }

  const lines = highlighted.split("\n");
  const body = (
    <Box flexDirection="column">
      {lines.map((l, i) => (
        <Text key={i} color={failed ? colors.err : undefined}>
          {l || " "}
        </Text>
      ))}
      {hidden > 0 ? (
        <Text dimColor>{bare ? "" : "  "}+{hidden} LINES HIDDEN</Text>
      ) : null}
    </Box>
  );
  if (bare) return body;
  return (
    <Box marginTop={0}>
      <Text color={colors.dim}>⎿ </Text>
      {body}
    </Box>
  );
}

// One tool/agent action as a tinted card. Header: glyph + name + short path + line badge.
// Body: diff | highlighted bash command. Output: syntax-highlighted, clamped.
export function ToolCard({ tool, fallback }: { tool?: ToolAction; fallback?: string }) {
  if (!tool) {
    return (
      <Box paddingLeft={2}>
        <Text dimColor>{fallback || "(tool)"}</Text>
      </Box>
    );
  }
  if (tool.name === "TodoWrite" && tool.output) return <TodoPanel json={tool.output} />;

  const kind = kindOf(tool.name);
  const tint = toolTint[kind];
  const okExit = tool.exitCode === undefined || tool.exitCode === 0;
  const outLines = tool.output ? lineCount(stripAnsi(tool.output)) : 0;
  const fileLang = langFor(tool.file);
  const { card, inner } = cardWidth();

  // Interior cells of a CodeBox hosted at `inner` width: border(2) + paddingX(2).
  const boxInner = Math.max(8, inner - 4);
  // The title band bleeds to the border, so it only loses the border cells.
  const bandW = Math.max(8, inner - 2);

  let body: React.ReactNode = null;
  let outputInBox = false;
  if (tool.diff) {
    // Adds/dels for the title band's right slot — the summary row leaves the box body.
    const adds = tool.diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
    const dels = tool.diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
    const meta = `+${adds} −${dels}`;
    const title = truncateStart(tool.file || "workspace", Math.max(4, bandW - displayWidth(meta) - 3));
    const gap = Math.max(1, bandW - displayWidth(title) - displayWidth(meta) - 2);
    // In the transcript there is no key handler, so a collapsed "press [d] to expand"
    // diff could never be opened — the edit's actual before/after was unreachable. Show
    // it, bounded, and drop the dead hint. Boxed per the design's `.code` treatment.
    body = (
      <CodeBox
        width={inner}
        header={
          <Text backgroundColor={surface.pastHeader}>
            <Text color={colors.bone} bold>{` ${title}`}</Text>
            {" ".repeat(gap)}
            <Text color={colors.ok}>+{adds}</Text>
            <Text color={colors.dim}> </Text>
            <Text color={colors.err}>−{dels}</Text>
            {" "}
          </Text>
        }
      >
        <DiffView
          diff={tool.diff}
          width={boxInner}
          expanded
          maxLines={MAX_OUTPUT_LINES}
          interactive={false}
          summary={false}
        />
      </CodeBox>
    );
  } else if (tool.command) {
    const cmdRows = wrapBlock(`$ ${tool.command}`, boxInner);
    let cmd = cmdRows.join("\n");
    try {
      cmd = highlight(cmd, { language: "bash", ignoreIllegals: true });
    } catch { /* keep raw */ }
    // Command and its output share one box, the way the design keeps a whole
    // execution inside a single `.code` block: the command reads at full strength,
    // a border-colored rule separates it from its (dim) output.
    outputInBox = Boolean(tool.output);
    body = (
      <CodeBox width={inner}>
        {cmd.split("\n").map((l, i) => (
          <Text key={i}>{l || " "}</Text>
        ))}
        {outputInBox ? (
          <>
            <Text color={surface.pastHeader}>{"─".repeat(boxInner)}</Text>
            <Output text={tool.output!} failed={!okExit} lang={fileLang} width={boxInner} bare />
          </>
        ) : null}
      </CodeBox>
    );
  }

  return (
    // A rail, not a box. Boxing every tool call put a hard coloured rectangle around a third
    // of the screen; the design language here is rules and rails, and the colour belongs on
    // the tool NAME, which is the part you actually scan for.
    <Box
      flexDirection="column"
      width={card}
      borderStyle="single"
      borderColor={colors.dim}
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      paddingLeft={1}
      marginTop={1}
    >
      {/* header row - the design's turn node (tab 09): a green check (red cross on failure)
          leads, then the tool in caps, then where it acted. The kind is carried by the
          label's tint, so the old leading kind-glyph is gone and the exit marker moves up
          front where the eye already scans for pass/fail. */}
      <Box>
        <Text color={okExit ? colors.ok : colors.err} bold>{okExit ? glyph.ok : glyph.fail} </Text>
        <Text color={tint} bold>{tool.name.toUpperCase()}</Text>
        {/* When a diff box follows, its title band owns the (full) path — repeating a
            shortened copy up here just said the same thing twice in two spellings. */}
        {tool.file && !tool.diff ? (
          <Text dimColor>
            {"  "}{shortPath(tool.file)}
          </Text>
        ) : null}
        {outLines > 0 ? (
          <Text dimColor>  ·  {outLines}L</Text>
        ) : null}
      </Box>
      {body}
      {tool.output && !outputInBox ? (
        <Output text={tool.output} failed={!okExit} lang={fileLang} width={inner - 2} />
      ) : null}
    </Box>
  );
}
