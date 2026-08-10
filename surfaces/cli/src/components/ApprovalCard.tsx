import React from "react";
import { Box, Text } from "ink";
import type { ApprovalRequest } from "@iqlabs-official/agent-sdk/runtime/approval/channel";
import { colors, glyph } from "../theme.js";
import { DiffView } from "./DiffView.js";
import { wrapHard } from "../format.js";

// The decision ring. ONE list drives both the rendered buttons and the key handler in
// Chat, so a hotkey can never drift from what the card says it does. Order is the
// ←/→ order, and index 0 is what a bare ↵ commits — allow, the overwhelmingly common
// answer, exactly like the vscode card's focused [Approve].
export const APPROVAL_CHOICES = [
  { key: "y", label: "allow once", tint: colors.ok },
  { key: "a", label: "always", tint: colors.iqMagenta },
  { key: "n", label: "deny", tint: colors.err },
  { key: "r", label: "deny + reason", tint: colors.iqViolet },
] as const;

export type ApprovalChoiceKey = (typeof APPROVAL_CHOICES)[number]["key"];

// A calm question, not an alarm — UNLESS the action is flagged risky, then we alarm on
// purpose (red border + warning). The exact command/diff/file is shown verbatim so the
// user decides on real information.
//
// Two shapes, same content:
//   popup=false → inline, takes the composer's slot in the chat frame (row-budgeted)
//   popup=true  → a bordered modal drawn OVER whatever overlay the user was on
export function ApprovalCard({
  req,
  reply = null,
  replyText = "",
  diffExpanded = false,
  activeDiffFileIdx = 0,
  maxRows = 12,
  selected = 0,
  popup = false,
}: {
  req: ApprovalRequest;
  reply?: "reason" | "edit" | null;
  replyText?: string;
  diffExpanded?: boolean;
  activeDiffFileIdx?: number;
  maxRows?: number; // rows the frame can give this band before it clips
  selected?: number; // index into APPROVAL_CHOICES highlighted for ↵
  popup?: boolean;
}) {
  const danger = req.risk === "danger";
  const accent = danger ? colors.err : colors.warn;
  const canEdit = req.kind === "bash";
  const cols = process.stdout.columns || 80;
  // popup draws a real border (2 cols) + padding (2); inline sits flush in the frame.
  const width = Math.max(24, cols - 2);
  const innerW = popup ? width - 4 : width;

  // corner focus marks (ㄱ top-right / ㄴ bottom-left), same language as the composer —
  // the inline card takes the composer's slot, so it wears the same frame.
  const cornerTop = " ".repeat(Math.max(0, cols - 5)) + (danger ? "══╗" : "──┐");
  const cornerBottom = danger ? "╚══" : "└──";

  // The inline card takes the composer's slot inside a FIXED-HEIGHT frame, so anything it
  // renders past `maxRows` is not scrolled — it is clipped away, bottom-first. The
  // bottom is where the keys live, so an unbounded card silently eats its own answer row
  // and the prompt reads as a truncated blob you can't act on. Budget the rows: the
  // question and the keys are fixed cost, the diff gets whatever is left. A popup owns
  // the whole screen, so it only needs to stay under the terminal height.
  const showCwd = req.kind === "bash" && Boolean(req.cwd);
  const fixedRows =
    1 + // marginTop
    1 + // corner top / border top
    1 + // "<cli> wants to use <tool>"
    1 + // title
    (req.command ? 1 : 0) +
    (showCwd ? 1 : 0) +
    (req.file ? 1 : 0) +
    (reply ? 4 : 3) + // reply editor (margin+label+input+hint) or margin+choices+hint
    1; // corner bottom / border bottom
  const budget = popup ? Math.max(6, (process.stdout.rows || 24) - 4) : maxRows;
  const diffRows = Math.max(0, budget - fixedRows);

  // Long commands/paths have no break opportunity, so ink cannot wrap them and they run
  // past the frame. Wrap them ourselves; show the head and fold the rest.
  const commandRows = req.command ? wrapHard(`$ ${req.command}`, innerW).slice(0, 3) : [];

  const body = (
    <>
      <Text color={accent} bold wrap="truncate-end">
        {danger ? "⚠ DANGER · " : `${glyph.thinking} `}
        {req.cli} wants to use {req.tool}
      </Text>
      <Text wrap="truncate-end">{req.title}</Text>
      {commandRows.map((r, i) => (
        <Text key={i} color={colors.iqCyan}>{r}</Text>
      ))}
      {showCwd ? <Text dimColor wrap="truncate-end">in {req.cwd}</Text> : null}
      {req.file ? <Text dimColor wrap="truncate-end">{req.file}</Text> : null}
      {req.diff && diffRows >= 3 ? (
        <DiffView
          diff={req.diff}
          width={innerW}
          // an expanded diff adds a tab row + a "N more lines" row on top of its lines
          maxLines={Math.max(1, diffRows - 2)}
          expanded={diffExpanded}
          activeFileIdx={activeDiffFileIdx}
        />
      ) : req.diff && diffRows >= 1 ? (
        <Text dimColor wrap="truncate-end">(diff hidden - terminal too short)</Text>
      ) : null}

      {reply ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={accent}>
            {reply === "reason" ? "deny: tell the model why:" : "edit command, then ↵ to run:"}
          </Text>
          <Box>
            <Text color={colors.iqCyan}>❯ </Text>
            <Text>
              {replyText}
              <Text inverse> </Text>
            </Text>
          </Box>
          <Text dimColor>↵ submit · esc back</Text>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          {/* the decision ring: ←/→ moves, ↵ commits the highlighted one. The letter in
              brackets still works directly, so nothing that used to be muscle memory
              stopped working. */}
          <Box>
            {APPROVAL_CHOICES.map((c, i) => {
              const on = i === selected;
              return (
                <Text key={c.key} color={on ? colors.ink : c.tint} backgroundColor={on ? c.tint : undefined} bold={on}>
                  {` [${c.key}] ${c.label} `}
                </Text>
              );
            })}
          </Box>
          <Text dimColor>
            {"←/→ move · ↵ "}
            {APPROVAL_CHOICES[selected]?.label ?? "allow once"}
            {req.diff ? " · [d] toggle diff" : ""}
            {canEdit ? " · [e] edit" : ""}
            {" · esc deny"}
          </Text>
        </Box>
      )}
    </>
  );

  if (popup) {
    // Drawn over an overlay (market, sessions, settings…). The user is somewhere else, so
    // say what happened and promise the way back — the same contract the vscode desktop
    // popup makes when the window isn't focused.
    return (
      <Box flexDirection="column" width={width} borderStyle={danger ? "double" : "round"} borderColor={accent} paddingX={1}>
        <Text color={accent} bold>
          {glyph.sparkle} APPROVAL NEEDED
          <Text dimColor>{"  ·  answering returns you to where you were"}</Text>
        </Text>
        {body}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={accent}>{cornerTop}</Text>
      {body}
      <Text color={accent}>{cornerBottom}</Text>
    </Box>
  );
}
