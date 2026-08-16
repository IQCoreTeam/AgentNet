// Skill detail — full parity with surfaces/webview/src/market/SkillDetailView.tsx:
// required-skills checkmarks + prices + "Collect all", full (scrollable) SKILL.md,
// full comment stack, dispose/re-equip, firing pulse on owned/deployed.
import React from "react";
import { Box, Text, useStdout } from "ink";
import type { SkillDetail, Note } from "@iqlabs-official/agent-sdk";
import { colors, glyph } from "../../theme.js";
import { displayWidth, truncateEnd, truncateStart, wrapBlock } from "../../format.js";
import { ScrollView } from "./ScrollView.js";
import { Band } from "../../components/Band.js";

export type DetailSub = "main" | "skillText" | "comments";

function noteDate(ts: number): string {
  return new Date(ts).toLocaleDateString();
}

const SOL = 1_000_000_000;
function priceLabel(price?: string | null): string {
  if (!price || price === "0") return "FREE";
  return `${(Number(price) / SOL).toFixed(3)} SOL`;
}
function shortMint(m?: string): string {
  return m && m.length > 12 ? `${m.slice(0, 6)}…${m.slice(-4)}` : m ?? "";
}

// Every row of the main body, each pre-bounded to exactly ONE terminal row: the viewport
// below slices this array by index, so a row that wrapped would break the scroll math
// (and, before this, the hashtag chips and long names wrapped into fragments at narrow
// widths). Exported so SkillMarket's input handler clamps the scroll against the same
// list it renders. `cols` is the raw terminal width; the frame's border+padding come off
// here so both callers agree.
export function mainLines(detail: SkillDetail, owned: Set<string>, cols: number): React.ReactNode[] {
  const w = Math.max(12, cols - 4);
  const c = detail.card;
  const requiredCards = detail.requiredCards ?? [];
  const unownedRequired = requiredCards.filter((r) => !owned.has(r.name));
  const totalSol = unownedRequired.reduce((sum, r) => sum + (r.price ? Number(r.price) / 1e9 : 0), 0);
  const lines: React.ReactNode[] = [];
  // one blank row before each block after the first, the same rhythm the unscrolled
  // layout had from its marginTop gaps.
  const gap = (k: string) => { if (lines.length) lines.push(<Text key={k}> </Text>); };

  if (c.description) {
    wrapBlock(c.description, w).forEach((l, i) => lines.push(<Text key={`d-${i}`}>{l}</Text>));
  }

  if (c.category || (c.hashtags && c.hashtags.length)) {
    gap("g-chips");
    const cat = c.category ? truncateEnd(c.category, w) : "";
    const tagRoom = w - displayWidth(cat) - (cat ? 1 : 0);
    const tags = tagRoom >= 2 ? truncateEnd((c.hashtags ?? []).map((h) => `#${h}`).join(" "), tagRoom) : "";
    lines.push(
      <Box key="chips">
        {cat ? <Text color={colors.iqViolet}>{cat}{tags ? " " : ""}</Text> : null}
        {tags ? <Text dimColor>{tags}</Text> : null}
      </Box>,
    );
  }

  if (requiredCards.length) {
    gap("g-req");
    lines.push(<Text key="req" dimColor>requires:</Text>);
    for (const r of requiredCards) {
      const reqOwned = owned.has(r.name);
      const tail = reqOwned ? "owned" : r.price ? `${(Number(r.price) / 1e9).toFixed(3)} SOL` : "free";
      lines.push(
        <Box key={`r-${r.id}`}>
          <Text color={reqOwned ? colors.ok : colors.warn}>{reqOwned ? glyph.ok : "○"} </Text>
          <Text>{truncateEnd(r.name, Math.max(2, w - 2 - displayWidth(tail) - 2))}</Text>
          <Text dimColor>  {tail}</Text>
        </Box>,
      );
    }
    if (unownedRequired.length > 0) {
      lines.push(
        <Text key="collect" color={colors.iqCyan}>
          {truncateEnd(`[x] collect all ${unownedRequired.length}${totalSol ? ` · ${totalSol.toFixed(3)} SOL` : ""}`, w)}
        </Text>,
      );
    }
  }

  if (detail.repos && detail.repos.length) {
    gap("g-repos");
    lines.push(<Box key="repos"><Band label="used by" note="VERIFIED REPOS · WHERE STARS COME FROM" /></Box>);
    for (const r of detail.repos) {
      const stars = `★${r.stars}`;
      lines.push(
        <Box key={`repo-${r.url}`}>
          <Text color={colors.iqCyan}>  {truncateEnd(`${r.owner}/${r.name}`, Math.max(2, w - 4 - displayWidth(stars) - 2))}</Text>
          <Text color={colors.warn}>  {stars}</Text>
        </Box>,
      );
    }
  }

  if (detail.skillText) {
    gap("g-md");
    lines.push(<Text key="md" dimColor>{truncateEnd(`── SKILL.md (${detail.skillText.split("\n").length} lines) ──`, w)}</Text>);
    const preview = detail.skillText.slice(0, 300) + (detail.skillText.length > 300 ? "…" : "");
    wrapBlock(preview, w).forEach((l, i) => lines.push(<Text key={`md-${i}`}>{l}</Text>));
    lines.push(<Text key="md-open" color={colors.iqCyan}>[v] view full</Text>);
  }

  gap("g-k");
  lines.push(<Text key="k" dimColor>[k] comments ({(detail.notes ?? []).length})</Text>);
  return lines;
}

// The main body's viewport height: what remains of the terminal after the fixed chrome
// (borders, header, name row, gaps, flash, buy band, hints, scroll position row) plus one
// row of slack - ink switches to its full-repaint path at outputHeight >= rows, which is
// exactly what left stale detail rows smeared behind short terminals. Never taller than
// the content, so a short detail stays compact. Shared by the render and the key clamp.
export function mainViewportH(rows: number, total: number): number {
  return Math.min(Math.max(4, rows - 15), total);
}

// SKILL.md subview rows: the raw file lines hard-wrapped to the content width, so one
// array entry is exactly one terminal row. The subview used to slice 16 RAW file lines,
// and a line that wraps 2-3x at narrow columns pushed the frame past the terminal (top
// border scrolled off, stale rows survived esc at 40x38). Exported so SkillMarket's key
// handler clamps the scroll against the same rows the view renders.
export function skillTextLines(detail: SkillDetail, cols: number): string[] {
  const w = Math.max(12, cols - 4);
  return wrapBlock(detail.skillText ?? "", w);
}

// Comments subview rows, one node per terminal row (date, wrapped quote rows, wrapped
// git link rows), for the same reason as skillTextLines: slice math is only true when a
// slice index equals a screen row, and a note used to be one multi-row node.
export function commentLines(notes: Note[], cols: number): React.ReactNode[] {
  const w = Math.max(12, cols - 4);
  const lines: React.ReactNode[] = [];
  for (const n of notes) {
    lines.push(<Text key={`${n.id}-d`} dimColor>  {truncateEnd(noteDate(n.timestamp), Math.max(1, w - 2))}</Text>);
    wrapBlock(`"${n.text}"`, Math.max(1, w - 2)).forEach((l, i) => lines.push(<Text key={`${n.id}-t${i}`}>  {l}</Text>));
    if (n.gitLink) {
      wrapBlock(`${glyph.sparkle} ${n.gitLink}`, Math.max(1, w - 4)).forEach((l, i) =>
        lines.push(<Text key={`${n.id}-g${i}`} dimColor>    {l}</Text>),
      );
    }
  }
  return lines;
}

// Subview viewport height: what remains of the terminal after the subview chrome (two
// border rows, title, two gaps, scroll position row, hint row = 7) plus one row of
// slack, for the same ink full-repaint reason as mainViewportH. Never taller than the
// content. Shared by both subviews and the key clamp, replacing the constants 16 and 12.
export function subViewportH(rows: number, total: number): number {
  return Math.min(Math.max(4, rows - 9), total);
}

export function SkillDetailView({
  detail,
  owned,
  disposed,
  isOwned,
  sub,
  scrollOffset,
  firing,
  flash,
  busy,
}: {
  detail: SkillDetail;
  owned: Set<string>;
  disposed: boolean;
  isOwned: boolean;
  sub: DetailSub;
  scrollOffset: number;
  firing: boolean;
  flash: string | null;
  busy: boolean;
}) {
  const c = detail.card;
  const notes = detail.notes ?? [];
  const stdoutMain = useStdout().stdout; // || not ??: detached pty reports 0 rows/cols
  const colsMain = stdoutMain?.columns || 80;
  const rowsMain = stdoutMain?.rows || 24;

  // both subviews: wrapped rows sized to the terminal, title and hint bounded to one
  // row each, so the frame never outgrows the terminal at narrow widths.
  const subInnerW = Math.max(12, colsMain - 4);

  if (sub === "skillText") {
    const bodyLines = skillTextLines(detail, colsMain);
    const height = subViewportH(rowsMain, bodyLines.length);
    return (
      <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
        <Text bold color={colors.iqMagenta}>{truncateEnd(`❖ ${c.name} · SKILL.md`, subInnerW)}</Text>
        <Box marginTop={1}>
          <ScrollView lines={bodyLines} height={height} offset={scrollOffset} />
        </Box>
        <Box marginTop={1}><Text dimColor>{truncateEnd("↑/↓/PgUp/PgDn scroll · esc back", subInnerW)}</Text></Box>
      </Box>
    );
  }

  if (sub === "comments") {
    const lines = commentLines(notes, colsMain);
    const height = subViewportH(rowsMain, lines.length);
    return (
      <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
        <Text bold color={colors.iqMagenta}>{truncateEnd(`❖ ${c.name} · comments (${notes.length})`, subInnerW)}</Text>
        <Box marginTop={1}>
          {notes.length === 0 ? <Text dimColor>no comments yet</Text> : <ScrollView lines={lines} height={height} offset={scrollOffset} />}
        </Box>
        <Box marginTop={1}><Text dimColor>{truncateEnd("↑/↓/PgUp/PgDn scroll · esc back", subInnerW)}</Text></Box>
      </Box>
    );
  }

  // main - fixed chrome (header, name, band, hints) around a line viewport, the same
  // shape the skillText/comments subviews use, so a fat detail scrolls on a short
  // terminal instead of emitting a 44+ row frame ink cannot erase.
  const kindWord = (c.type ?? "skill").toUpperCase();
  const lines = mainLines(detail, owned, colsMain);
  const height = mainViewportH(rowsMain, lines.length);
  const scrolls = lines.length > height;
  // the two chrome rows above the viewport, budgeted to ONE terminal row each:
  // unbudgeted, the header (kind + mint + soulbound) wrapped into two fused rows at 30
  // cols and a long name clipped with no ellipsis. The mint keeps its END visible
  // (truncateStart): the tail is what identifies it. When everything fits, the shown
  // strings are the originals, so wide terminals render byte identical.
  const innerW = Math.max(12, colsMain - 4);
  const bond = c.type === "workflow" ? " · soulbound token-2022" : " · soulbound";
  const mintRoom = Math.max(4, innerW - displayWidth(kindWord) - 2);
  const mintShown = truncateStart(shortMint(c.id), mintRoom);
  const bondRoom = mintRoom - displayWidth(mintShown);
  const bondShown = displayWidth(bond) <= bondRoom ? bond : bondRoom >= 4 ? truncateEnd(bond, bondRoom) : "";
  const fireW = firing ? 2 : 0;
  const statsTail = `  ×${c.supply ?? 0}${c.stars ? ` · ★${c.stars}` : ""}${isOwned ? (disposed ? " · disposed" : " · owned") : ""}`;
  const statsRoom = Math.max(0, innerW - fireW - Math.min(displayWidth(c.name), 12));
  const statsShown = displayWidth(statsTail) <= statsRoom ? statsTail : statsRoom >= 4 ? truncateEnd(statsTail, statsRoom) : "";
  const nameShown = truncateEnd(c.name, Math.max(2, innerW - fireW - displayWidth(statsShown)));
  // the FIXED hint row carries the live comment count: the body's counter line sits
  // inside the scroll region, so on short terminals a fresh post's increment was
  // invisible without scrolling down to it. Budgeted to one row: the scroll piece
  // drops first (the viewport's own arrow row still shows scrollability), then the
  // row cuts with an ellipsis as the last resort.
  const hintLead = busy ? "working…" : isOwned ? (disposed ? "[e] re-equip · " : "[d] dispose · ") : "[b] buy · ";
  const hintTail = `[c] comment · [v] SKILL.md · [k] comments (${notes.length}) · esc back`;
  const hintFull = `${hintLead}${scrolls ? "↑/↓ scroll · " : ""}${hintTail}`;
  const hint = displayWidth(hintFull) <= innerW ? hintFull
    : displayWidth(`${hintLead}${hintTail}`) <= innerW ? `${hintLead}${hintTail}`
    : truncateEnd(`${hintLead}${hintTail}`, innerW);
  return (
    <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
      <Box justifyContent="space-between">
        <Text bold color={colors.bone}>{kindWord}</Text>
        <Text dimColor>{mintShown}{bondShown}</Text>
      </Box>
      <Box marginTop={1}>
        <Text bold color={colors.iqCyan}>{nameShown}</Text>
        {firing ? <Text color={colors.iqMagenta}> ✦</Text> : null}
        <Text dimColor>{statsShown}</Text>
      </Box>
      <ScrollView lines={lines} height={height} offset={scrollOffset} />

      {flash ? <Box marginTop={1}><Text color={colors.ok}>{glyph.sparkle} {flash}</Text></Box> : null}
      <Box marginTop={1}>
        <Band
          label="buy"
          note={`${priceLabel(c.price)} · MINTS YOUR COPY, NEVER TRANSFERABLE`}
          inverted
        />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{hint}</Text>
      </Box>
    </Box>
  );
}
