import React from "react";
import { Box, Text } from "ink";
import type { ApprovalRequest } from "@iqlabs-official/agent-sdk/runtime/approval/channel";
import { colors, glyph, tag } from "../theme.js";
import { DiffView } from "./DiffView.js";
import { wrapHard, wrapBlock, padCells, displayWidth } from "../format.js";

// The decision ring. ONE list drives both the rendered buttons and the key handler in
// Chat, so a hotkey can never drift from what the card says it does. Order is the
// ←/→ order, and index 0 is what a bare ↵ commits — allow, the overwhelmingly common
// answer, exactly like the vscode card's focused [Approve]. `cell` is the compact
// uppercase label the design's key grid shows; `label` is the sentence the hint spells.
export const APPROVAL_CHOICES = [
  { key: "y", cell: "ONCE", label: "allow once", tint: colors.ok },
  { key: "a", cell: "ALWAYS", label: "always", tint: colors.bone },
  { key: "n", cell: "DENY", label: "deny", tint: colors.err },
  { key: "r", cell: "REASON", label: "deny + reason", tint: colors.iqViolet },
] as const;

export type ApprovalChoiceKey = (typeof APPROVAL_CHOICES)[number]["key"];

// A calm question, not an alarm — UNLESS the action is flagged risky, then we alarm on
// purpose (red band + warning). The exact command/diff/file is shown verbatim so the
// user decides on real information.
//
// Three shapes share this one slot (design tab 27): a tool-permission card (bash/edit/…),
// a PLAN card (ExitPlanMode), and a QUESTION card (AskUserQuestion). Each renders its own
// band + body; the key grid only appears for the permission shape.
//
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
  qCursor = 0,
  qChecked = [],
  qIndex = 0,
  popup = false,
}: {
  req: ApprovalRequest;
  reply?: "reason" | "edit" | "custom" | null;
  replyText?: string;
  diffExpanded?: boolean;
  activeDiffFileIdx?: number;
  maxRows?: number; // rows the frame can give this band before it clips
  selected?: number; // index into APPROVAL_CHOICES highlighted for ↵
  qCursor?: number; // question: highlighted option row
  qChecked?: number[]; // question: checked option rows (multiSelect)
  qIndex?: number; // question: which question of many we are on
  popup?: boolean;
}) {
  const danger = req.risk === "danger";
  const accent = danger ? colors.danger : colors.ok;
  const canEdit = req.kind === "bash";
  const cols = process.stdout.columns || 80;
  // popup draws a real border (2 cols) + padding (2); inline sits flush in the frame.
  const width = Math.max(24, cols - 2);
  const innerW = popup ? width - 4 : width;

  const question = req.kind === "question" ? req.questions?.[qIndex] : undefined;
  const isPlan = req.kind === "plan";

  // corner focus marks, same language as the composer — the inline card takes the
  // composer's slot, so it wears the same frame.
  const cornerTop = " ".repeat(Math.max(0, cols - 5)) + (danger ? "══╗" : "──┐");
  const cornerBottom = danger ? "╚══" : "└──";

  // The inline card takes the composer's slot inside a FIXED-HEIGHT frame, so anything it
  // renders past `maxRows` is not scrolled — it is clipped away, bottom-first. The
  // bottom is where the keys live, so an unbounded card silently eats its own answer row
  // and the prompt reads as a truncated blob you can't act on. Budget the rows: the
  // fixed chrome is counted, the diff/plan/options get whatever is left.
  const showCwd = req.kind === "bash" && Boolean(req.cwd);
  const fixedRows =
    1 + // marginTop
    1 + // corner top / border top
    1 + // //REQUEST_ band (or //ASK_ / //PLAN_)
    (question ? 1 : isPlan ? 0 : 1) + // title (permission) or question prompt line
    (req.command ? 1 : 0) +
    (showCwd ? 1 : 0) +
    (req.file ? 1 : 0) +
    (reply ? 4 : 3) + // reply editor (margin+label+input+hint) or margin+keys+hint
    1; // corner bottom / border bottom
  const budget = popup ? Math.max(6, (process.stdout.rows || 24) - 4) : maxRows;
  const bodyRows = Math.max(0, budget - fixedRows);

  // An inverted band: label pinned left, detail pinned right, filling the inner width.
  const bandRow = (left: string, right: string): string => {
    const gap = innerW - displayWidth(left) - displayWidth(right);
    if (gap < 1) return padCells(`${left} ${right}`, innerW).slice(0, innerW);
    return padCells(left + " ".repeat(gap) + right, innerW);
  };
  const bandBg = danger ? colors.danger : colors.ok;
  const bandFg = danger ? colors.bone : colors.ink;

  // Long commands/paths have no break opportunity, so ink cannot wrap them and they run
  // past the frame. Wrap them ourselves; show the head and fold the rest.
  const commandRows = req.command ? wrapHard(`$ ${req.command}`, innerW).slice(0, 3) : [];

  // The decision grid's row budget is ONE row (fixedRows counts it as one). Below the
  // width where every worded cell fits, the words shed and the bracketed letters
  // survive - [Y] [A] [N] [R], plus [E]/[D] where they apply - because a wrapped grid
  // silently makes the card taller than the budget Chat granted it, which at 30x24 was
  // one of the rows that pushed the approval frame past the terminal into ink's
  // clear-and-repaint path. The hint row underneath still spells out the highlighted
  // choice, so no meaning is lost, only the redundant words.
  const gridCells = APPROVAL_CHOICES.map((c) => ` [${c.key.toUpperCase()}] ${c.cell} `);
  const gridW =
    gridCells.reduce((n, s) => n + displayWidth(s), 0) + (req.diff ? displayWidth("  [D] DIFF") : 0);
  const compactKeys = gridW > innerW;

  // ── PLAN (Kind B): the model wants to leave plan mode. ↵ runs it, esc keeps planning.
  const planBody = isPlan ? (
    <>
      <Text backgroundColor={bandBg} color={bandFg} bold>
        {bandRow(tag("plan"), `${glyph.thinking} ${req.cli.toUpperCase()} PROPOSES A PLAN`)}
      </Text>
      {wrapBlock(req.plan ?? req.title, innerW)
        .slice(0, Math.max(1, bodyRows))
        .map((r, i) => (
          <Text key={i} dimColor>
            {r}
          </Text>
        ))}
    </>
  ) : null;

  // ── QUESTION (Kind A): AskUserQuestion. The user's PICK becomes the tool result, so
  // this is a choice list, not a yes/no gate. ↵ answers; the options are numbered.
  const questionBody = question ? (
    <>
      <Text backgroundColor={bandBg} color={bandFg} bold>
        {bandRow(
          tag(question.header || "ask"),
          (req.questions?.length ?? 1) > 1
            ? `${qIndex + 1} OF ${req.questions?.length} · ${req.cli.toUpperCase()} ASKS`
            : `${req.cli.toUpperCase()} ASKS`,
        )}
      </Text>
      {wrapBlock(question.question, innerW)
        .slice(0, 2)
        .map((r, i) => (
          <Text key={i} wrap="truncate-end">
            {r}
          </Text>
        ))}
      {question.options.slice(0, Math.max(1, bodyRows)).map((o, i) => {
        const on = i === qCursor;
        const checked = qChecked.includes(i);
        const mark = question.multiSelect ? (checked ? "[x] " : "[ ] ") : "";
        const line = ` ${i + 1} ${mark}${o.label}${o.description ? `  ${o.description}` : ""}`;
        return (
          <Text
            key={i}
            color={on ? colors.ink : colors.bone}
            backgroundColor={on ? colors.bone : undefined}
            bold={on}
            wrap="truncate-end"
          >
            {padCells(line, on ? innerW : displayWidth(line))}
          </Text>
        );
      })}
    </>
  ) : null;

  // ── PERMISSION (Kind C / tab 05): bash/edit/write/read/other. Green //REQUEST_ band
  // (red when danger), the exact command/diff/file, then the decision grid.
  const permissionBody =
    !isPlan && !question ? (
      <>
        <Text backgroundColor={bandBg} color={bandFg} bold>
          {bandRow(
            danger ? tag("danger") : tag("request"),
            `${glyph.thinking} ${req.cli.toUpperCase()} WANTS TO USE ${req.tool.toUpperCase()}`,
          )}
        </Text>
        <Box justifyContent="space-between">
          <Text wrap="truncate-end">{req.title}</Text>
          {req.file ? (
            <Text dimColor wrap="truncate-start">
              {req.file}
            </Text>
          ) : null}
        </Box>
        {commandRows.map((r, i) => (
          <Text key={i} color={colors.ok}>
            {r}
          </Text>
        ))}
        {showCwd ? (
          <Text dimColor wrap="truncate-end">
            in {req.cwd}
          </Text>
        ) : null}
        {req.diff && bodyRows >= 3 ? (
          <DiffView
            diff={req.diff}
            width={innerW}
            maxLines={Math.max(1, bodyRows - 2)}
            expanded={diffExpanded}
            activeFileIdx={activeDiffFileIdx}
          />
        ) : req.diff && bodyRows >= 1 ? (
          <Text dimColor wrap="truncate-end">
            (diff hidden - terminal too short)
          </Text>
        ) : null}
      </>
    ) : null;

  // The footer under the body: the typed reply editor, or the key row for this kind.
  const footer = reply ? (
    <Box marginTop={1} flexDirection="column">
      <Text color={accent}>
        {reply === "reason"
          ? "deny: tell the model why:"
          : reply === "custom"
            ? "type your own answer, then ↵:"
            : "edit command, then ↵ to run:"}
      </Text>
      <Box>
        <Text color={colors.ok}>❯ </Text>
        <Text>
          {replyText}
          <Text inverse> </Text>
        </Text>
      </Box>
      <Text dimColor>↵ submit · esc back</Text>
    </Box>
  ) : question ? (
    <Box marginTop={1} flexDirection="column">
      <Text dimColor wrap="truncate-end">
        {"↑/↓ move · "}
        {question.multiSelect ? "space toggle · ↵ confirm" : "↵ answer"}
        {question.allowCustomInput ? " · [t] type your own" : ""}
        {" · esc cancel"}
      </Text>
    </Box>
  ) : isPlan ? (
    <Box marginTop={1} flexDirection="column">
      <Text>
        <Text color={colors.ok} bold>
          {"↵ approve and run"}
        </Text>
        <Text dimColor>{"   ·   esc keep planning"}</Text>
      </Text>
    </Box>
  ) : (
    <Box marginTop={1} flexDirection="column">
      {/* the decision grid: ←/→ moves, ↵ commits the highlighted one. The letter in
          brackets still works directly, so nothing that used to be muscle memory
          stopped working. */}
      <Box>
        {APPROVAL_CHOICES.map((c, i) => {
          const on = i === selected;
          return (
            <Text
              key={c.key}
              color={on ? colors.ink : c.tint}
              backgroundColor={on ? c.tint : undefined}
              bold={on}
            >
              {compactKeys ? ` [${c.key.toUpperCase()}] ` : gridCells[i]}
            </Text>
          );
        })}
        {compactKeys && canEdit ? <Text dimColor>{" [E]"}</Text> : null}
        {req.diff ? <Text dimColor>{compactKeys ? " [D]" : "  [D] DIFF"}</Text> : null}
      </Box>
      <Text dimColor wrap="truncate-end">
        {"←/→ move · ↵ "}
        {APPROVAL_CHOICES[selected]?.label ?? "allow once"}
        {canEdit ? " · [e] edit" : ""}
        {" · esc deny"}
      </Text>
    </Box>
  );

  const body = (
    <>
      {permissionBody}
      {planBody}
      {questionBody}
      {footer}
    </>
  );

  if (popup) {
    // Drawn over an overlay (market, sessions, settings…). The user is somewhere else, so
    // say what happened and promise the way back — the same contract the vscode desktop
    // popup makes when the window isn't focused.
    return (
      <Box
        flexDirection="column"
        width={width}
        borderStyle={danger ? "double" : "round"}
        borderColor={accent}
        paddingX={1}
      >
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
