// GitHub verified-work screen for the CLI market, ported from the app's two
// onboarding views (surfaces/webview ConnectGithub.tsx + RegisterWorkRepo.tsx)
// into ink boxes. Two modes gated on whether a token is stored, matching the app:
// no token -> paste a Personal Access Token; token present -> register a repo as
// verified work for the skills it used. Core owns everything real (token storage
// saveGithubToken/maskedGithubToken 0600 file, and registerVerifiedWork which
// commits the public .agentnet marker then registers with the indexer); this file
// is pure render, the same split the CLI's HeliusPanel uses for the RPC key.
import React from "react";
import { Box, Text } from "ink";
import { colors, glyph } from "../../theme.js";
import type { OwnedSkill } from "../../components/WelcomePanel.js";

// Pre-fills GitHub's new-token page with the repo scope (write to your repos, needed
// to commit the .agentnet marker) plus a description, so a user creates the right token
// in one step. Same URL the app uses (ConnectGithub.tsx).
const TOKEN_URL = "https://github.com/settings/tokens/new?scopes=repo&description=AgentNet";

export interface GithubStatusLite {
  hasToken: boolean;
  masked: string | null;
}

// Which sub-field of the register form has focus. Only meaningful once a token is
// stored; without one the screen is a single token-entry field.
export type GithubFocus = "token" | "repo" | "skills";

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
  repoInput,
  owned,
  selected,
  focus,
  skillIdx,
  blockReason,
  busy,
  flash,
}: {
  status: GithubStatusLite | null;
  tokenInput: string;
  repoInput: string;
  owned: OwnedSkill[];
  selected: Record<string, boolean>;
  focus: GithubFocus;
  skillIdx: number;
  blockReason: string | null;
  busy: boolean;
  flash: string | null;
}) {
  const hasToken = !!status?.hasToken;
  const chosen = Object.values(selected).filter(Boolean).length;
  return (
    <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={colors.iqViolet}>
      <Text bold color={colors.iqMagenta}>❖ GitHub verified work</Text>
      <Box marginTop={1}>
        <Text dimColor>status  </Text>
        <GithubBadge status={status} />
      </Box>

      {!hasToken ? (
        // No token yet: one field to paste the Personal Access Token.
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
            <Text dimColor>paste a Personal Access Token · ↵ save · esc back</Text>
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
        // Token present: register a repo as verified work for the skills it used.
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text color={focus === "token" ? colors.iqCyan : colors.dim}>{focus === "token" ? "▸ " : "  "}</Text>
            <Text dimColor>token </Text>
            <Text>{status?.masked}</Text>
            <Text dimColor>  [x] remove</Text>
          </Box>
          <Box>
            <Text color={focus === "repo" ? colors.iqCyan : colors.dim}>{focus === "repo" ? "▸ " : "  "}</Text>
            <Text dimColor>repo  </Text>
            <Text dimColor={!repoInput}>{repoInput || "owner/name or github.com URL"}</Text>
            {focus === "repo" ? <Text inverse> </Text> : null}
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text color={focus === "skills" ? colors.iqCyan : colors.dim}>{focus === "skills" ? "▸ " : "  "}skills this repo used</Text>
            {owned.length === 0 ? (
              <Text dimColor>  no owned skills yet</Text>
            ) : (
              owned.map((s, i) => {
                const on = !!selected[s.id];
                const cursor = focus === "skills" && i === skillIdx;
                return (
                  <Box key={s.id}>
                    <Text color={cursor ? colors.iqCyan : colors.dim}>{cursor ? "  ▸ " : "    "}</Text>
                    <Text color={on ? colors.ok : colors.dim}>{on ? "[x]" : "[ ]"} </Text>
                    <Text color={on ? colors.bone : colors.dim}>{s.name}</Text>
                  </Box>
                );
              })
            )}
          </Box>
          {/* one gate slot: the reason register can't fire yet, or - only when it
              actually can - the explicit go signal naming the key and the field. */}
          {blockReason ? (
            <Box marginTop={1}><Text color={colors.warn}>{blockReason}</Text></Box>
          ) : (
            <Box marginTop={1}>
              <Text color={colors.ok}>ready · ↵ on repo registers {chosen} skill{chosen === 1 ? "" : "s"}</Text>
            </Box>
          )}
          {flash ? <Box marginTop={1}><Text color={colors.ok}>{glyph.sparkle} {flash}</Text></Box> : null}
          <Box marginTop={1}>
            <Text dimColor>
              {focus === "token"
                ? "↵/[x] remove token · [tab] field · esc back"
                : focus === "repo"
                  ? (blockReason ? "[tab] field · esc back" : "↵ register · [tab] field · esc back")
                  : "↑/↓ move · ↵/[space] toggle · [tab] field · esc back"}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
