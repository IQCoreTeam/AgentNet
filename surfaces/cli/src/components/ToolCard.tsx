import React from "react";
import { Box, Text } from "ink";
import { highlight } from "cli-highlight";
import type { ToolAction } from "@iqlabs-official/agent-sdk/runtime/contract";
import { glyph, toolTint, colors } from "../theme.js";
import { TodoPanel } from "./TodoPanel.js";
import { DiffView } from "./DiffView.js";
import { stripAnsi, clampLines, lineCount } from "../format.js";

const MAX_OUTPUT_LINES = 14;

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

// Command output / read content: ANSI-stripped, line-clamped, with a fold note.
function Output({ text }: { text: string }) {
  const clean = stripAnsi(text);
  const { shown, hidden } = clampLines(clean, MAX_OUTPUT_LINES);
  if (!shown.trim()) return null;
  return (
    <Box flexDirection="column">
      <Text dimColor>{shown}</Text>
      {hidden > 0 ? <Text dimColor>⎿ +{hidden} more lines</Text> : null}
    </Box>
  );
}

// One tool/agent action as a tinted, bordered card. Substance (command, output, diff) is
// shown verbatim — the card is just framing, with line-count badges and folds.
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

  let body: React.ReactNode = null;
  if (tool.diff) body = <DiffView diff={tool.diff} />;
  else if (tool.command) {
    let cmd = tool.command;
    try {
      cmd = highlight(tool.command, { language: "bash", ignoreIllegals: true });
    } catch {
      /* keep raw */
    }
    body = <Text>$ {cmd}</Text>;
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={tint} paddingX={1} marginLeft={2}>
      <Box>
        <Text color={tint} bold>
          {kindGlyph[kind]} {tool.name}
        </Text>
        {tool.file ? <Text dimColor> {tool.file}</Text> : null}
        {outLines > 0 ? <Text dimColor> · {outLines} line{outLines === 1 ? "" : "s"}</Text> : null}
        {tool.exitCode !== undefined ? (
          <Text color={okExit ? colors.ok : colors.err}>
            {"  "}
            {okExit ? glyph.ok : glyph.fail} {tool.exitCode}
          </Text>
        ) : null}
      </Box>
      {body}
      {tool.output ? <Output text={tool.output} /> : null}
    </Box>
  );
}
