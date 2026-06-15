import React from "react";
import { Box, Text } from "ink";
import { highlight } from "cli-highlight";
import { basename, extname } from "node:path";
import type { ToolAction } from "@iqlabs-official/agent-sdk/runtime/contract";
import { glyph, toolTint, colors } from "../theme.js";
import { TodoPanel } from "./TodoPanel.js";
import { DiffView } from "./DiffView.js";
import { stripAnsi, clampLines, lineCount } from "../format.js";

const MAX_OUTPUT_LINES = 12;

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
}: {
  text: string;
  failed?: boolean;
  lang?: string;
}) {
  const clean = stripAnsi(text);
  const { shown, hidden } = clampLines(clean, MAX_OUTPUT_LINES);
  if (!shown.trim()) return null;

  let highlighted = shown;
  if (lang && !failed) {
    try {
      highlighted = highlight(shown, { language: lang, ignoreIllegals: true });
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

  let body: React.ReactNode = null;
  if (tool.diff) body = <DiffView diff={tool.diff} />;
  else if (tool.command) {
    let cmd = tool.command;
    try {
      cmd = highlight(tool.command, { language: "bash", ignoreIllegals: true });
    } catch { /* keep raw */ }
    body = <Text dimColor>$ {cmd}</Text>;
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={tint} paddingX={1} marginLeft={1} marginTop={1}>
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
        <Output text={tool.output} failed={!okExit} lang={fileLang} />
      ) : null}
    </Box>
  );
}
