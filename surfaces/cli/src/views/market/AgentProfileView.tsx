// Agent profile — full parity with surfaces/webview/src/market/AgentProfileView.tsx:
// tier tag + gauge + ladder, earned SOL, verified GitHub repos, blog carousel, full
// comment stack, buy-all with count feedback, self-only "write a blog post" entry.
import React from "react";
import { Box, Text } from "ink";
import type { AgentProfile, SkillCard, Note } from "@iqlabs-official/agent-sdk";
import { colors, glyph } from "../../theme.js";
import { tierInfo, tierGauge, repoGauge, STAR_TIERS } from "./tiers.js";
import { ScrollView } from "./ScrollView.js";

const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;

function earnedSol(totalEarned?: string): string {
  const lamports = totalEarned ? Number(totalEarned) : 0;
  const solVal = lamports / 1e9;
  return (solVal >= 100 ? solVal.toFixed(0) : solVal.toFixed(2)) + "◎";
}

function noteDate(ts: number): string {
  return new Date(ts).toLocaleDateString();
}

export type ProfileSub = "main" | "repos" | "comments" | "blog";

export function AgentProfileView({
  profile,
  owned,
  buyAllResult,
  busy,
  sub,
  scrollOffset,
  self,
}: {
  profile: AgentProfile;
  owned: Set<string>;
  buyAllResult: string | null;
  busy: boolean;
  sub: ProfileSub;
  scrollOffset: number;
  self: boolean;
}) {
  const r = profile.reputation;
  const stars = r.stars ?? 0;
  const { cur, next } = tierInfo(stars);
  const blogNotes = (profile.notes ?? []).filter((n) => n.isSelfNote);
  const comments = (profile.notes ?? []).filter((n) => !n.isSelfNote);
  const allSkills = profile.createdSkills ?? [];
  const unowned = allSkills.filter((s) => !owned.has(s.name));

  if (sub === "repos") {
    const repos = [...(profile.verifiedRepos ?? [])].sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0));
    const lines = repos.map((repo) => (
      <Box key={repo.url} flexDirection="column">
        <Text>
          <Text color={colors.iqCyan}>{repo.owner}/{repo.name}</Text>
          <Text dimColor>  {repo.skillMints.length} skill{repo.skillMints.length !== 1 ? "s" : ""} linked</Text>
        </Text>
        <Text dimColor>  ★{repo.stars} {repoGauge(repo.stars)}</Text>
      </Box>
    ));
    return (
      <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
        <Text bold color={colors.iqMagenta}>❖ verified repos ({repos.length})</Text>
        <Box flexDirection="column" marginTop={1}>
          {repos.length === 0 ? <Text dimColor>no verified repos</Text> : <ScrollView lines={lines} height={10} offset={scrollOffset} />}
        </Box>
        <Box marginTop={1}><Text dimColor>↑/↓/PgUp/PgDn scroll · esc back</Text></Box>
      </Box>
    );
  }

  if (sub === "comments") {
    const lines = comments.map((n: Note) => (
      <Box key={n.id} flexDirection="column">
        <Text>
          <Text color={colors.iqCyan}>{short(n.author)}</Text>
          <Text dimColor>  {noteDate(n.timestamp)}</Text>
        </Text>
        {n.title ? <Text bold>{n.title}</Text> : null}
        <Text>  {n.text}</Text>
        {n.gitLink ? <Text dimColor>  {glyph.sparkle} {n.gitLink}</Text> : null}
      </Box>
    ));
    return (
      <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
        <Text bold color={colors.iqMagenta}>❖ comments ({comments.length})</Text>
        <Box flexDirection="column" marginTop={1}>
          {comments.length === 0 ? <Text dimColor>no comments yet</Text> : <ScrollView lines={lines} height={12} offset={scrollOffset} />}
        </Box>
        <Box marginTop={1}><Text dimColor>↑/↓/PgUp/PgDn scroll · esc back</Text></Box>
      </Box>
    );
  }

  if (sub === "blog") {
    const lines = blogNotes.map((n: Note) => (
      <Box key={n.id} flexDirection="column" marginBottom={1}>
        {n.title ? <Text bold color={colors.iqCyan}>{n.title}</Text> : null}
        {n.text ? <Text>  {n.text}</Text> : null}
        {n.image ? <Text dimColor>  [image: {n.image}]</Text> : null}
        {n.gitLink ? <Text dimColor>  {glyph.sparkle} {n.gitLink}</Text> : null}
        <Text dimColor>  {noteDate(n.timestamp)}</Text>
      </Box>
    ));
    return (
      <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
        <Text bold color={colors.iqMagenta}>❖ blog ({blogNotes.length})</Text>
        <Box flexDirection="column" marginTop={1}>
          {blogNotes.length === 0 ? <Text dimColor>no posts yet</Text> : <ScrollView lines={lines} height={12} offset={scrollOffset} />}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>{self ? "[n] new post · " : ""}↑/↓/PgUp/PgDn scroll · esc back</Text>
        </Box>
      </Box>
    );
  }

  // main
  return (
    <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
      <Box>
        <Text bold color={colors.iqCyan}>{short(r.wallet)}</Text>
        {cur ? <Text color={colors.warn}>  [{cur.name}]</Text> : null}
        <Text dimColor>  {r.skillsPublished} skills · ×{r.totalSupply} supply · {r.notesReceived} notes</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>tier  </Text><Text>{tierGauge(stars)}</Text>
      </Box>
      <Box>
        <Text dimColor>ladder</Text>
        {STAR_TIERS.map((t) => (
          <Text key={t.name} color={stars >= t.min ? colors.ok : colors.dim}> {t.name}({t.min})</Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>earned </Text><Text color={colors.ok}>{earnedSol(r.totalEarned)}</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          [r] verified repos ({(profile.verifiedRepos ?? []).length}) · [k] comments ({comments.length}) · [g] blog ({blogNotes.length})
        </Text>
      </Box>

      {allSkills.length ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>skills:</Text>
          {allSkills.slice(0, 8).map((s: SkillCard) => (
            <Box key={s.id}>
              <Text>  · </Text>
              <Text color={owned.has(s.name) ? colors.ok : undefined}>{s.name}</Text>
              {owned.has(s.name) ? <Text color={colors.ok}> owned</Text> : null}
            </Box>
          ))}
        </Box>
      ) : null}

      {buyAllResult ? (
        <Box marginTop={1}><Text color={colors.ok}>{glyph.sparkle} {buyAllResult}</Text></Box>
      ) : null}

      <Box marginTop={1}>
        <Text dimColor>
          {busy
            ? "buying…"
            : unowned.length === 0
              ? "all skills owned · "
              : unowned.length === allSkills.length
                ? `[b] buy all ${unowned.length} skill${unowned.length !== 1 ? "s" : ""} · `
                : `[b] buy ${unowned.length} more skill${unowned.length !== 1 ? "s" : ""} · `}
          {self ? "[n] new post · " : ""}esc back
        </Text>
      </Box>
    </Box>
  );
}
