import React from "react";
import { Box, Text } from "ink";
import { highlight } from "cli-highlight";
import type { ToolAction } from "@iqlabs-official/agent-sdk/runtime/contract";
import { glyph, toolTint, colors } from "../theme.js";
import { TodoPanel } from "./TodoPanel.js";

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

// Color a unified-ish diff: +green / -red, context dim. The diff text comes straight
// from the engine — we only tint it, never rewrite it.
function Diff({ diff }: { diff: string }) {
  return (
    <Box flexDirection="column">
      {diff.split("\n").map((line, i) => {
        const c = line.startsWith("+") ? colors.ok : line.startsWith("-") ? colors.err : undefined;
        return (
          <Text key={i} color={c} dimColor={!c}>
            {line || " "}
          </Text>
        );
      })}
    </Box>
  );
}

// One tool/agent action as a tinted, bordered card. Substance (command, output, diff)
// is shown verbatim — the card is just framing.
export function ToolCard({ tool, fallback }: { tool?: ToolAction; fallback?: string }) {
  if (!tool) {
    return (
      <Box paddingLeft={2}>
        <Text dimColor>{fallback || "(tool)"}</Text>
      </Box>
    );
  }
  // TodoWrite renders as a checklist, not a generic card.
  if (tool.name === "TodoWrite" && tool.output) return <TodoPanel json={tool.output} />;

  const kind = kindOf(tool.name);
  const tint = toolTint[kind];
  const okExit = tool.exitCode === undefined || tool.exitCode === 0;

  let body: React.ReactNode = null;
  if (tool.diff) body = <Diff diff={tool.diff} />;
  else if (tool.command) {
    let cmd = tool.command;
    try {
      cmd = highlight(tool.command, { language: "bash", ignoreIllegals: true });
    } catch {
      /* keep raw */
    }
    body = <Text>$ {cmd}</Text>;
  } else if (tool.file) body = <Text dimColor>{tool.file}</Text>;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={tint} paddingX={1} marginLeft={2}>
      <Box>
        <Text color={tint} bold>
          {kindGlyph[kind]} {tool.name}
        </Text>
        {tool.file ? <Text dimColor> {tool.file}</Text> : null}
        {tool.exitCode !== undefined ? (
          <Text color={okExit ? colors.ok : colors.err}>
            {"  "}
            {okExit ? glyph.ok : glyph.fail} {tool.exitCode}
          </Text>
        ) : null}
      </Box>
      {body}
      {tool.output ? (
        <Text dimColor>{tool.output.length > 1200 ? tool.output.slice(0, 1200) + " …" : tool.output}</Text>
      ) : null}
    </Box>
  );
}
