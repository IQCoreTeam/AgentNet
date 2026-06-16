import React from "react";
import { Box, Text } from "ink";
import { colors } from "../theme.js";

interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

// Render a TodoWrite tool action as a live checklist (the items arrive as JSON in
// tool.output — see convert/claude.ts). Mirrors the Claude Code todo panel.
export function TodoPanel({ json }: { json: string }) {
  let todos: Todo[] = [];
  try {
    todos = JSON.parse(json) as Todo[];
  } catch {
    return null;
  }
  if (!todos.length) return null;
  const done = todos.filter((t) => t.status === "completed").length;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={colors.iqViolet} paddingX={1} marginLeft={2}>
      <Text color={colors.iqViolet} bold>
        ✓ todos {done}/{todos.length}
      </Text>
      {todos.map((t, i) => {
        const box = t.status === "completed" ? "[✓]" : t.status === "in_progress" ? "[▸]" : "[ ]";
        const color =
          t.status === "completed" ? colors.ok : t.status === "in_progress" ? colors.iqCyan : undefined;
        const label = t.status === "in_progress" && t.activeForm ? t.activeForm : t.content;
        return (
          <Box key={i}>
            <Text color={color}>{box} </Text>
            <Text color={color} strikethrough={t.status === "completed"} dimColor={t.status === "pending"}>
              {label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
