import React from "react";
import { Box, Text } from "ink";
import type { ChatMessage } from "@iqlabs-official/agent-sdk/runtime/contract";
import { glyph, colors, tag } from "../theme.js";
import { ToolCard } from "./ToolCard.js";
import { Markdown } from "./Markdown.js";

// Render one transcript message by role. Tool messages defer to <ToolCard>. The most
// recent assistant line types out (live=true) to FEEL like streaming; older lines render
// whole. The author label uses the message's own .cli so cross-CLI threads badge right.
export function Message({ msg, live }: { msg: ChatMessage; live?: boolean }) {
  if (msg.role === "tool") return <ToolCard tool={msg.tool} fallback={msg.text} />;

  if (msg.role === "user") {
    return (
      <Box marginTop={1}>
        <Text color={colors.user} bold>
          {tag("you")}{" "}
        </Text>
        <Text>{msg.text}</Text>
      </Box>
    );
  }

  if (msg.role === "thinking") {
    return (
      <Box paddingLeft={2}>
        <Text color={colors.iqViolet} italic>
          {glyph.thinking} {msg.text}
        </Text>
      </Box>
    );
  }

  if (msg.role === "summary") {
    return (
      <Box marginTop={1}>
        <Text color={colors.iqViolet}>
          {glyph.summary} {msg.text}
        </Text>
      </Box>
    );
  }

  // assistant
  const who = msg.cli === "codex" ? "codex" : "claude";
  return <Assistant text={msg.text} who={who} live={!!live} />;
}

function Assistant({ text, who, live }: { text: string; who: string; live: boolean }) {
  // while live (turn in progress), show raw text — real token deltas already stream it in.
  // once the turn settles, re-render as full markdown (headings, lists, code, inline).
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={colors.bone} bold>
        {tag(who)}
      </Text>
      <Box paddingLeft={2}>{live ? <Text>{text || "…"}</Text> : <Markdown text={text} />}</Box>
    </Box>
  );
}
