// GitHub verified-work screen for the CLI market, ported from the app's two
// onboarding views (surfaces/webview ConnectGithub.tsx + RegisterWorkRepo.tsx)
// into ink boxes. Two modes gated on whether a token is stored, matching the app:
// no token -> paste a Personal Access Token; token present -> register a repo as
// verified work for the skills it used. Core owns everything real (token storage
// saveGithubToken/maskedGithubToken 0600 file, and registerVerifiedWork which
// commits the public .agentnet marker then registers with the indexer); this file
// is pure render, the same split the CLI's HeliusPanel uses for the RPC key.
//
// The register form is ONE vertical focus list walked with up/down: token row,
// repo input, each owned skill, then a REGISTER action row. Enter acts on the
// focused row; the focused row renders as the welcome panel's fully inverted
// band (ink on bone, edge to edge), the design's strongest focus signature.
import React from "react";
import { Box, Text } from "ink";
import { colors, glyph } from "../../theme.js";
import { displayWidth, truncateEnd } from "../../format.js";
import type { OwnedSkill } from "../../components/WelcomePanel.js";

// Pre-fills GitHub's new-token page with the repo scope (write to your repos, needed
// to commit the .agentnet marker) plus a description, so a user creates the right token
// in one step. Same URL the app uses (ConnectGithub.tsx).
const TOKEN_URL = "https://github.com/settings/tokens/new?scopes=repo&description=AgentNet";

export interface GithubStatusLite {
  hasToken: boolean;
  masked: string | null;
}

// The ONE focus order of the register form, walked with up/down (tab cycles it as an
// alternate): token, repo, each owned skill, register. Both the SkillMarket input
// handler and the render below read it from here, so they can never disagree.
export type GithubRow =
  | { kind: "token" }
  | { kind: "repo" }
  | { kind: "skill"; skill: number }
  | { kind: "register" };

export function githubRowCount(skillCount: number): number {
  return 3 + skillCount;
}

export function githubRowAt(idx: number, skillCount: number): GithubRow {
  if (idx <= 0) return { kind: "token" };
  if (idx === 1) return { kind: "repo" };
  if (idx < 2 + skillCount) return { kind: "skill", skill: idx - 2 };
  return { kind: "register" };
}

// The focused row, drawn exactly like a focused welcome panel band: fully inverted,
// ink on bone, edge to edge. `cursor` appends a block cursor for the text-input row.
function FocusBand({ width, text, cursor }: { width: number; text: string; cursor?: boolean }) {
  const room = Math.max(4, width - (cursor ? 1 : 0));
  const fitted = truncateEnd(text, room);
  const pad = Math.max(0, width - displayWidth(fitted) - (cursor ? 1 : 0));
  return (
    <Text backgroundColor={colors.bone} color={colors.ink} bold>
      {fitted}
      {cursor ? <Text backgroundColor={colors.ink} color={colors.bone}> </Text> : null}
      {" ".repeat(pad)}
    </Text>
  );
}

function GithubBadge({ status }: { status: GithubStatusLite | null }) {
  if (!status) return null;
  if (status.hasToken) {
    return <Text color={colors.ok}>{glyph.ok} connected · {status.masked}</Text>;
  }
  return <Text color={colors.warn}>no token · add one to register verified work</Text>;
}

export function GithubPanel({
  status,
  tokenInput,
  tokenEditing,
  repoInput,
  repoLabel,
  owned,
  selected,
  focusIdx,
  blockReason,
  busy,
  flash,
  width,
}: {
  status: GithubStatusLite | null;
  tokenInput: string;
  tokenEditing: boolean;
  repoInput: string;
  repoLabel: string | null; // parsed owner/name once the repo input is valid
  owned: OwnedSkill[];
  selected: Record<string, boolean>;
  focusIdx: number;
  blockReason: string | null;
  busy: boolean;
  flash: string | null;
  width: number; // inner row width (terminal cols minus border and padding)
}) {
  const hasToken = !!status?.hasToken;
  const chosen = Object.values(selected).filter(Boolean).length;
  const row = githubRowAt(focusIdx, owned.length);
  const bandW = Math.max(10, width);
  return (
    <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
      <Text bold color={colors.iqMagenta}>❖ GitHub verified work</Text>
      <Box marginTop={1}>
        <Text dimColor>status  </Text>
        <GithubBadge status={status} />
      </Box>

      {!hasToken || tokenEditing ? (
        // Token entry: paste a Personal Access Token (first connect, or replacing a
        // stored token via enter on the token row).
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text color={colors.iqCyan}>▸ </Text>
            <Text dimColor>token </Text>
            <Text>{tokenInput}</Text>
            <Text inverse> </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>create a token (repo scope): </Text>
            <Text color={colors.iqCyan}>{TOKEN_URL}</Text>
          </Box>
          {flash ? <Box marginTop={1}><Text color={colors.ok}>{flash}</Text></Box> : null}
          {busy ? <Text dimColor>saving...</Text> : null}
          <Box marginTop={1}>
            <Text dimColor>
              {tokenEditing
                ? "paste the new token · enter save · esc cancel"
                : "paste a Personal Access Token · enter save · esc back"}
            </Text>
          </Box>
        </Box>
      ) : busy ? (
        // Registering: the two working steps, mirroring the app's step rows.
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>{glyph.ok} commit .agentnet marker</Text>
          <Text dimColor>{glyph.ok} register with the indexer</Text>
          <Box marginTop={1}><Text dimColor>working...</Text></Box>
        </Box>
      ) : (
        // Token present: one vertical focus list, up/down walks it, enter acts.
        <Box flexDirection="column" marginTop={1}>
          {row.kind === "token" ? (
            <FocusBand width={bandW} text={`  token ${status?.masked ?? ""}`} />
          ) : (
            <Box>
              <Text dimColor>  token </Text>
              <Text>{status?.masked}</Text>
            </Box>
          )}
          {row.kind === "repo" ? (
            <FocusBand width={bandW} text={`  repo  ${repoInput}`} cursor />
          ) : (
            <Box>
              <Text dimColor>  repo  </Text>
              <Text dimColor={!repoInput}>{repoInput || "owner/name or github.com URL"}</Text>
            </Box>
          )}
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>  skills this repo used</Text>
            {owned.length === 0 ? (
              <Text dimColor>    no owned skills yet</Text>
            ) : (
              owned.map((s, i) => {
                const on = !!selected[s.id];
                if (row.kind === "skill" && row.skill === i) {
                  return <FocusBand key={s.id} width={bandW} text={`    ${on ? "[x]" : "[ ]"} ${s.name}`} />;
                }
                return (
                  <Box key={s.id}>
                    <Text color={on ? colors.ok : colors.dim}>{"    "}{on ? "[x]" : "[ ]"} </Text>
                    <Text color={on ? colors.bone : colors.dim}>{s.name}</Text>
                  </Box>
                );
              })
            )}
          </Box>
          {/* The REGISTER action row, always visible and honest: the go text when it
              can fire, otherwise the ONE gate reason, rendered here and only here. */}
          <Box marginTop={1}>
            {(() => {
              const label = blockReason
                ? ` ${blockReason}`
                : ` register ${chosen} skill${chosen === 1 ? "" : "s"} to ${repoLabel}`;
              if (row.kind === "register") return <FocusBand width={bandW} text={label} />;
              return blockReason
                ? <Text dimColor>{label}</Text>
                : <Text bold color={colors.ok}>{label}</Text>;
            })()}
          </Box>
          {flash ? <Box marginTop={1}><Text color={colors.ok}>{glyph.sparkle} {flash}</Text></Box> : null}
          <Box marginTop={1}>
            <Text dimColor>
              {row.kind === "token"
                ? "up/down move · enter edit token · [x] remove · esc back"
                : row.kind === "repo"
                  ? "type the repo · up/down move · enter next · esc back"
                  : row.kind === "skill"
                    ? "up/down move · enter toggle · esc back"
                    : blockReason
                      ? "up/down move · esc back"
                      : "enter register · esc back"}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
