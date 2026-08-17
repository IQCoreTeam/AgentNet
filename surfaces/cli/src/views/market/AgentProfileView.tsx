// Agent profile — full parity with surfaces/webview/src/market/AgentProfileView.tsx:
// tier tag + gauge + ladder, earned SOL, verified GitHub repos, blog carousel, full
// comment stack, buy-all with count feedback, self-only "write a blog post" entry.
import React from "react";
import { Box, Text, useStdout } from "ink";
import type { AgentProfile, SkillCard, Note } from "@iqlabs-official/agent-sdk";
import { colors, glyph, tierColor } from "../../theme.js";
import { displayWidth } from "../../format.js";
import { tierInfo, tierGauge, TierGauge, repoGauge, STAR_TIERS } from "./tiers.js";
import { walletColor, walletFace } from "./avatar.js";
import { ScrollView } from "./ScrollView.js";
import { Band } from "../../components/Band.js";

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
  walletAddr,
}: {
  profile: AgentProfile;
  owned: Set<string>;
  buyAllResult: string | null;
  busy: boolean;
  sub: ProfileSub;
  scrollOffset: number;
  self: boolean;
  // the VIEWER's wallet: marks their own comments "// YOU" in the threads
  // (design tab 22); `self` above is about the profile's subject, not the viewer.
  walletAddr?: string;
}) {
  const r = profile.reputation;
  // wallet-face identity (design tab 20 //AVATAR_): same wallet, same face on the
  // hero and on every comment author. Sheds below 40 cols like the directory rows.
  const cols = useStdout().stdout?.columns || 80;
  const showFace = cols >= 40;
  const stars = r.stars ?? 0;
  const { cur, next } = tierInfo(stars);
  // Threads arrive pre-grouped from the host (GH #101). Blog = the agent's own posts;
  // comments = holder threads with replies flattened to the 2-level cap.
  const blogNotes = (profile.threads ?? []).filter((t) => t.note.isSelfNote).map((t) => t.note);
  const commentThreads = (profile.threads ?? []).filter((t) => !t.note.isSelfNote);
  const commentCount = commentThreads.reduce((sum, t) => sum + 1 + t.replies.length, 0);
  const allSkills = profile.createdSkills ?? [];
  const unowned = allSkills.filter((s) => !owned.has(s.name));
  // design tab 22 gate: you may comment on an agent only while holding a skill they made.
  const heldFromAgent = allSkills.filter((s) => owned.has(s.name)).length;
  const canComment = !self && heldFromAgent > 0;

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
    // Each thread: the top-level comment, then its replies indented with an ↳ and
    // (when the reply answered a deeper comment) a → to whom.
    // every author carries their wallet face, and the viewer's own comments say
    // // YOU in green (design tab 22's thread identity language).
    const author = (wallet: string) => (
      <>
        {showFace ? <Text color={walletColor(wallet)}>{walletFace(wallet)} </Text> : null}
        <Text color={colors.iqCyan}>{short(wallet)}</Text>
        {walletAddr && wallet === walletAddr ? <Text color={colors.ok}> // YOU</Text> : null}
      </>
    );
    const lines = commentThreads.flatMap((t) => [
      <Box key={t.note.id} flexDirection="column">
        <Text>
          {author(t.note.author)}
          <Text dimColor>  {noteDate(t.note.timestamp)}</Text>
        </Text>
        {t.note.title ? <Text bold>{t.note.title}</Text> : null}
        <Text>  {t.note.text}</Text>
        {t.note.gitLink ? <Text dimColor>  {glyph.sparkle} {t.note.gitLink}</Text> : null}
      </Box>,
      ...t.replies.map((rep) => (
        <Box key={rep.id} flexDirection="column" marginLeft={2}>
          <Text>
            <Text dimColor>↳ </Text>
            {author(rep.author)}
            <Text dimColor>  {noteDate(rep.timestamp)}{rep.parentAuthor ? ` → ${short(rep.parentAuthor)}` : ""}</Text>
          </Text>
          {rep.title ? <Text bold>{rep.title}</Text> : null}
          <Text>  {rep.text}</Text>
        </Box>
      )),
    ]);
    return (
      <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
        <Box>
          <Text dimColor>AGENT  </Text>
          <Text bold color={colors.ink} backgroundColor={colors.bone}> COMMUNITY ({commentCount}) </Text>
        </Box>
        <Box marginTop={1}>
          <Band label="thread" note="TWO LEVELS · REPLIES COLLAPSE UNDER THEIR TOP COMMENT" />
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {commentCount === 0 ? <Text dimColor>no comments yet</Text> : <ScrollView lines={lines} height={10} offset={scrollOffset} />}
        </Box>
        <Box marginTop={1}>
          {self ? (
            <Text dimColor>this is your profile · holders comment here</Text>
          ) : canComment ? (
            <Text>
              <Text color={colors.ok}>{glyph.ok} UNLOCKED</Text>
              <Text dimColor> · you hold {heldFromAgent} · [c] write a comment</Text>
            </Text>
          ) : (
            <Text>
              <Text color={colors.err}>⚠ GATED</Text>
              <Text dimColor> · hold a skill made by this agent to comment</Text>
            </Text>
          )}
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
        <Text bold color={colors.bone}>BLOG ({blogNotes.length})</Text>
        <Box marginTop={1}>
          <Band label="blog" note="SELF NOTES · AUTHOR EQUALS SUBJECT · WRITTEN ON CHAIN" />
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {blogNotes.length === 0 ? <Text dimColor>no posts yet</Text> : <ScrollView lines={lines} height={10} offset={scrollOffset} />}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>{self ? "[n] new post · " : ""}↑/↓/PgUp/PgDn scroll · esc back</Text>
        </Box>
      </Box>
    );
  }

  // main
  const held = self ? profile.createdSkills?.length ?? 0 : heldFromAgent;
  // The tier row and the ladder are measured against the frame's inner width
  // (cols minus border 2 and paddingX 2) so a narrow terminal sheds whole
  // pieces instead of letting ink wrap them mid-word into a two-line jumble.
  const innerW = Math.max(12, cols - 4);
  // "  to Silver" is an appendix on the gauge row; it sheds whole when the row
  // cannot seat it (the gauge's own "74/250" count still names the progress).
  const showTo = next != null && displayWidth(`tier  ${tierGauge(stars)}  to ${next.name}`) <= innerW;
  // Ladder rungs shed right to left below the ladder's natural width, the same
  // idiom the directory row and the hero use for the wallet face: a rung renders
  // whole (name, count, decorations) or not at all, never as a wrapped fragment.
  let ladderUsed = displayWidth("ladder");
  const rungs: typeof STAR_TIERS = [];
  for (const t of STAR_TIERS) {
    const w = 1 + displayWidth(`${t.name}(${t.min})`);
    if (ladderUsed + w > innerW) break;
    rungs.push(t);
    ladderUsed += w;
  }
  return (
    <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
      <Box justifyContent="space-between">
        <Text bold color={colors.bone}>
          AGENT  {showFace ? <Text color={walletColor(r.wallet)}>{walletFace(r.wallet)} </Text> : null}
          <Text color={colors.iqCyan}>{short(r.wallet)}</Text>
          {self ? <Text color={colors.ok}> // YOU</Text> : null}
        </Text>
        {/* the hero badge wears its metal, the same tierColor the directory row uses */}
        <Text color={cur ? tierColor(cur.name) : colors.dim}>{cur ? cur.name.toUpperCase() : "UNRANKED"}</Text>
      </Box>
      {/* big-number stat row, like the design's profile hero */}
      <Box marginTop={1}>
        <Box width={16}><Text><Text bold color={colors.bone}>{r.skillsPublished}</Text><Text dimColor> CREATED</Text></Text></Box>
        <Box width={16}><Text><Text bold color={colors.bone}>{r.totalSupply}</Text><Text dimColor> COPIES</Text></Text></Box>
        <Box width={16}><Text><Text bold color={colors.bone}>{held}</Text><Text dimColor> OWNED</Text></Text></Box>
      </Box>
      {/* the single MAX on this row belongs to the gauge itself (tiers.tsx paints
          it green); appending another word here is what printed "MAX  MAX" */}
      <Box marginTop={1}>
        <Text dimColor>tier  </Text><TierGauge stars={stars} />
        {next && showTo ? <Text dimColor>  to {next.name}</Text> : null}
      </Box>
      {/* each rung wears its own metal once reached; the rung you stand on is inverted
          so CURRENT pops out of the flood of rungs passed long ago. Unreached = dim. */}
      <Box>
        <Text dimColor>ladder</Text>
        {rungs.map((t) => (
          <Text key={t.name}>
            {" "}
            <Text
              color={stars >= t.min ? tierColor(t.name) : colors.dim}
              bold={cur?.name === t.name}
              inverse={cur?.name === t.name}
            >
              {t.name}({t.min})
            </Text>
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>earned </Text><Text color={colors.ok}>{earnedSol(r.totalEarned)}</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          [r] verified repos ({(profile.verifiedRepos ?? []).length}) · [k] comments ({commentCount}) · [g] blog ({blogNotes.length})
          {canComment ? " · [c] comment" : ""}
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
