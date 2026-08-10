import React from "react";
import { Box, Text } from "ink";
import type { ChatMessage } from "@iqlabs-official/agent-sdk/runtime/contract";
import { glyph, colors, tag } from "../theme.js";
import { ToolCard } from "./ToolCard.js";
import { Markdown } from "./Markdown.js";
import { wrapBlock, padCells } from "../format.js";

// The transcript is a list of TURNS, ported from the vscode surface: your message opens a
// turn as a solid inverted band, and everything the agent does in reply hangs off a rail
// under it. The band is what makes a long scrollback scannable - you find your own words,
// not a wall of output. (A terminal cannot pin a header the way the webview does, so the
// band carries that job: it is the only inverted thing on screen.)
export function TurnHeader({ text }: { text: string }) {
  const inner = Math.max(10, (process.stdout.columns || 80) - 4); // frame paddingX + "> "
  const lines = wrapBlock(text, inner);
  return (
    <Box flexDirection="column" marginTop={1}>
      {lines.map((l, i) => (
        <Text key={i} backgroundColor={colors.bone} color={colors.ink} bold>
          {i === 0 ? "❯ " : "  "}
          {padCells(l, inner)}
        </Text>
      ))}
    </Box>
  );
}

// One reply inside a turn: rail on the left so it reads as hanging off the header above.
function Reply({ children }: { children: React.ReactNode }) {
  return (
    <Box
      borderStyle="single"
      borderColor={colors.dim}
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      paddingLeft={1}
      flexDirection="column"
    >
      {children}
    </Box>
  );
}

// Render one transcript message by role. Tool messages defer to <ToolCard>. The most
// recent assistant line types out (live=true) to FEEL like streaming; older lines render
// whole. The author label uses the message's own .cli so cross-CLI threads badge right.
export function Message({ msg, live }: { msg: ChatMessage; live?: boolean }) {
  if (msg.role === "user") return <TurnHeader text={msg.text} />;

  if (msg.role === "tool") {
    return (
      <Reply>
        <ToolCard tool={msg.tool} fallback={msg.text} />
      </Reply>
    );
  }

  if (msg.role === "thinking") {
    return (
      <Reply>
        <Text color={colors.iqViolet} italic>
          {glyph.thinking} {msg.text}
        </Text>
      </Reply>
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
  return (
    <Reply>
      <Assistant text={msg.text} who={who} live={!!live} />
    </Reply>
  );
}

function Assistant({ text, who, live }: { text: string; who: string; live: boolean }) {
  // while live (turn in progress), show raw text — real token deltas already stream it in.
  // once the turn settles, re-render as full markdown (headings, lists, code, inline).
  // Width: the frame's paddingX(1) each side, minus this reply's rail + paddingLeft.
  const width = Math.max(20, (process.stdout.columns || 80) - 4);
  return (
    <Box flexDirection="column">
      <Text color={colors.bone} bold>
        {tag(who)}
      </Text>
      {live ? <Text>{text || "…"}</Text> : <Markdown text={text} width={width} />}
    </Box>
  );
}
