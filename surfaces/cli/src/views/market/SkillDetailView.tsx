// Skill detail — full parity with surfaces/webview/src/market/SkillDetailView.tsx:
// required-skills checkmarks + prices + "Collect all", full (scrollable) SKILL.md,
// full comment stack, dispose/re-equip, firing pulse on owned/deployed.
import React from "react";
import { Box, Text } from "ink";
import type { SkillDetail, Note } from "@iqlabs-official/agent-sdk";
import { colors, glyph } from "../../theme.js";
import { ScrollView } from "./ScrollView.js";

export type DetailSub = "main" | "skillText" | "comments";

function noteDate(ts: number): string {
  return new Date(ts).toLocaleDateString();
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
  const requiredCards = detail.requiredCards ?? [];
  const unownedRequired = requiredCards.filter((r) => !owned.has(r.name));
  const totalSol = unownedRequired.reduce((sum, r) => sum + (r.price ? Number(r.price) / 1e9 : 0), 0);

  if (sub === "skillText") {
    const bodyLines = (detail.skillText ?? "").split("\n");
    return (
      <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
        <Text bold color={colors.iqMagenta}>❖ {c.name} · SKILL.md</Text>
        <Box marginTop={1}>
          <ScrollView lines={bodyLines} height={16} offset={scrollOffset} />
        </Box>
        <Box marginTop={1}><Text dimColor>↑/↓/PgUp/PgDn scroll · esc back</Text></Box>
      </Box>
    );
  }

  if (sub === "comments") {
    const lines = notes.map((n: Note) => (
      <Box key={n.id} flexDirection="column">
        <Text dimColor>  {noteDate(n.timestamp)}</Text>
        <Text>  "{n.text}"</Text>
        {n.gitLink ? <Text dimColor>    {glyph.sparkle} {n.gitLink}</Text> : null}
      </Box>
    ));
    return (
      <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
        <Text bold color={colors.iqMagenta}>❖ {c.name} · comments ({notes.length})</Text>
        <Box marginTop={1}>
          {notes.length === 0 ? <Text dimColor>no comments yet</Text> : <ScrollView lines={lines} height={12} offset={scrollOffset} />}
        </Box>
        <Box marginTop={1}><Text dimColor>↑/↓/PgUp/PgDn scroll · esc back</Text></Box>
      </Box>
    );
  }

  // main
  return (
    <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
      <Box>
        <Text bold color={colors.iqCyan}>{c.name}</Text>
        {firing ? <Text color={colors.iqMagenta}> ✦</Text> : null}
        <Text dimColor>  {c.type ?? "skill"} · ×{c.supply ?? 0}{c.stars ? ` · ★${c.stars}` : ""}{isOwned ? (disposed ? " · disposed" : " · owned") : ""}</Text>
      </Box>
      {c.description ? <Text>{c.description}</Text> : null}
      {c.category || (c.hashtags && c.hashtags.length) ? (
        <Box marginTop={1}>
          {c.category ? <Text color={colors.iqViolet}>{c.category} </Text> : null}
          {(c.hashtags ?? []).map((h) => (
            <Text key={h} dimColor>#{h} </Text>
          ))}
        </Box>
      ) : null}

      {requiredCards.length ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>requires:</Text>
          {requiredCards.map((r) => {
            const reqOwned = owned.has(r.name);
            const priceSol = r.price ? (Number(r.price) / 1e9).toFixed(3) : null;
            return (
              <Box key={r.id}>
                <Text color={reqOwned ? colors.ok : colors.warn}>{reqOwned ? glyph.ok : "○"} </Text>
                <Text>{r.name}</Text>
                <Text dimColor>  {reqOwned ? "owned" : priceSol ? `${priceSol} SOL` : "free"}</Text>
              </Box>
            );
          })}
          {unownedRequired.length > 0 ? (
            <Text color={colors.iqCyan}>[x] collect all {unownedRequired.length}{totalSol ? ` · ${totalSol.toFixed(3)} SOL` : ""}</Text>
          ) : null}
        </Box>
      ) : null}

      {detail.repos && detail.repos.length ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>used by · <Text color={colors.warn}>★{c.stars ?? detail.repos.reduce((s, r) => s + (r.stars || 0), 0)}</Text></Text>
          {detail.repos.map((r) => (
            <Box key={r.url}>
              <Text color={colors.iqCyan}>  {r.owner}/{r.name}</Text>
              <Text color={colors.warn}>  ★{r.stars}</Text>
            </Box>
          ))}
        </Box>
      ) : null}

      {detail.skillText ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>── SKILL.md ({detail.skillText.split("\n").length} lines) ──</Text>
          <Text>{detail.skillText.slice(0, 300)}{detail.skillText.length > 300 ? "…" : ""}</Text>
          <Text color={colors.iqCyan}>[v] view full</Text>
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text dimColor>[k] comments ({notes.length})</Text>
      </Box>

      {flash ? <Box marginTop={1}><Text color={colors.ok}>{glyph.sparkle} {flash}</Text></Box> : null}
      <Box marginTop={1}>
        <Text dimColor>
          {busy ? "working…" : isOwned
            ? disposed
              ? "[e] re-equip · "
              : "[d] dispose · "
            : "[b] buy · "}
          [c] comment · [v] SKILL.md · [k] comments · esc back
        </Text>
      </Box>
    </Box>
  );
}
