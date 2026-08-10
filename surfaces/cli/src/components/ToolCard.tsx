import React from "react";
import { Box, Text } from "ink";
import { highlight } from "cli-highlight";
import { basename, extname } from "node:path";
import type { ToolAction } from "@iqlabs-official/agent-sdk/runtime/contract";
import { glyph, toolTint, colors } from "../theme.js";
import { TodoPanel } from "./TodoPanel.js";
import { DiffView } from "./DiffView.js";
import { stripAnsi, clampLines, lineCount, wrapBlock } from "../format.js";

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

const kindGlyph: Record<string, string> = {
  bash: glyph.bash,
  edit: glyph.edit,
  write: glyph.write,
  read: glyph.read,
  agent: glyph.agent,
  other: glyph.other,
};

// Output block: syntax-highlighted when a language is known, else plain.
// Clamped to MAX_OUTPUT_LINES; fold note shows hidden count.
function Output({
  text,
  failed,
  lang,
  width,
}: {
  text: string;
  failed?: boolean;
  lang?: string;
  width: number;
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
  return (
    <Box marginTop={0}>
      <Text color={colors.dim}>⎿ </Text>
      <Box flexDirection="column">
        {lines.map((l, i) => (
          <Text key={i} color={failed ? colors.err : undefined}>
            {l || " "}
          </Text>
        ))}
        {hidden > 0 ? (
          <Text dimColor>  +{hidden} more lines</Text>
        ) : null}
      </Box>
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

  let body: React.ReactNode = null;
  if (tool.diff) {
    // In the transcript there is no key handler, so a collapsed "press [d] to expand"
    // diff could never be opened — the edit's actual before/after was unreachable. Show
    // it, bounded, and drop the dead hint.
    body = <DiffView diff={tool.diff} width={inner} expanded maxLines={MAX_OUTPUT_LINES} interactive={false} />;
  } else if (tool.command) {
    const cmdRows = wrapBlock(`$ ${tool.command}`, inner);
    let cmd = cmdRows.join("\n");
    try {
      cmd = highlight(cmd, { language: "bash", ignoreIllegals: true });
    } catch { /* keep raw */ }
    body = (
      <Box flexDirection="column">
        {cmd.split("\n").map((l, i) => (
          <Text key={i} dimColor>{l || " "}</Text>
        ))}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={card} borderStyle="single" borderColor={tint} paddingX={1} marginLeft={1} marginTop={1}>
      {/* header row */}
      <Box>
        <Text color={tint} bold>{kindGlyph[kind]} {tool.name}</Text>
        {tool.file ? (
          <Text dimColor>
            {"  "}{shortPath(tool.file)}
          </Text>
        ) : null}
        {outLines > 0 ? (
          <Text dimColor>  ·  {outLines}L</Text>
        ) : null}
        {tool.exitCode !== undefined ? (
          <Text color={okExit ? colors.ok : colors.err}>
            {"  "}{okExit ? glyph.ok : glyph.fail}
          </Text>
        ) : null}
      </Box>
      {body}
      {tool.output ? (
        <Output text={tool.output} failed={!okExit} lang={fileLang} width={inner - 2} />
      ) : null}
    </Box>
  );
}
