import React, { useState } from "react";
import { Box, Text } from "ink";
import { Select, TextInput } from "@inkjs/ui";
import { STORAGE_OPTIONS, type StorageConfig, type StorageKind } from "@iqlabs-official/agent-sdk";
import type { CliReport, CliStatus } from "@iqlabs-official/agent-sdk";
import { colors, glyph } from "../theme.js";
import { Iggy } from "../components/Iggy.js";

// First-run setup. Shows the REAL engine status (detectCli — vscode never does this) so
// the user fixes a missing/logged-out CLI before starting, then PICKS which engine to
// activate (claude or codex — not forced through claude), then picks where sessions save.
// "This device only" = skip cloud (local is always on). icloud/custom ask for a path/URL;
// gdrive opens a browser during connect. onDone(engine, cfg?) → cfg undefined = local.
//
// Codex is gated "coming soon": its login flow + interactive approvals aren't wired yet
// (codex-sdk exposes approvalPolicy only — see runtime/spawn.ts), so selecting it shows a
// note and doesn't advance. Claude is the only engine that onboards end-to-end today.
function statusBadge(s: CliStatus) {
  if (s === "ok") return <Text color={colors.ok}>{glyph.ok} ready</Text>;
  if (s === "no-login") return <Text color={colors.warn}>! not logged in</Text>;
  return <Text color={colors.err}>{glyph.fail} not installed</Text>;
}

export function Onboarding({
  report,
  address,
  onDone,
}: {
  report: CliReport;
  address: string;
  onDone: (engine: "claude" | "codex", cfg?: StorageConfig) => void;
}) {
  // engine pick comes first; null = still choosing. codexNote shows the coming-soon
  // message after a codex pick (which doesn't advance).
  const [engine, setEngine] = useState<"claude" | "codex" | null>(null);
  const [codexNote, setCodexNote] = useState(false);
  const [kind, setKind] = useState<StorageKind | null>(null);
  const [location, setLocation] = useState("");

  // engine chosen → claude advances to storage; codex is coming-soon (show note, stay).
  function chooseEngine(e: "claude" | "codex") {
    if (e === "codex") return setCodexNote(true);
    setCodexNote(false);
    setEngine("claude");
  }

  // backend chosen → either finish now (gdrive/local) or ask for a path/url first.
  // engine is locked to claude by the time we reach storage (codex never advances).
  function chooseKind(k: StorageKind) {
    const eng = engine ?? "claude";
    if (k === "local") return onDone(eng); // local-only, no cloud mirror
    if (k === "gdrive") return onDone(eng, { kind: "gdrive" }); // browser opens during connect
    setKind(k); // icloud / custom → collect a location next
  }

  return (
    <Box flexDirection="column" paddingX={1} gap={1}>
      <Box>
        <Iggy mood="idle" />
        <Text bold color={colors.iqMagenta}>
          {" "}welcome to AgentNet
        </Text>
      </Box>
      <Text dimColor>wallet {address.slice(0, 6)}…{address.slice(-4)}</Text>

      <Box flexDirection="column">
        <Box>
          <Text>claude </Text>
          {statusBadge(report.claude)}
        </Box>
        <Box>
          <Text>codex&nbsp; </Text>
          {statusBadge(report.codex)}
        </Box>
      </Box>

      {engine === null ? (
        <Box flexDirection="column">
          <Text color={colors.iqCyan}>which engine do you want to use?</Text>
          <Select
            options={[
              { label: "Claude", value: "claude" },
              { label: "Codex (coming soon)", value: "codex" },
            ]}
            onChange={(v) => chooseEngine(v as "claude" | "codex")}
          />
          {codexNote && (
            <Text color={colors.warn}>
              Codex isn't ready yet — login + approvals aren't wired. Pick Claude for now.
            </Text>
          )}
        </Box>
      ) : kind === null ? (
        <Box flexDirection="column">
          <Text color={colors.iqCyan}>where should your sessions live?</Text>
          <Text dimColor>(local is always on — a cloud just mirrors it)</Text>
          <Select
            options={STORAGE_OPTIONS.map((o) => ({
              label: `${o.label} — ${o.needs}`,
              value: o.kind,
            }))}
            onChange={(v) => chooseKind(v as StorageKind)}
          />
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text color={colors.iqCyan}>
            {kind === "icloud" ? "iCloud folder path:" : "endpoint base URL:"}
          </Text>
          <TextInput
            placeholder={kind === "icloud" ? "~/Library/Mobile Documents/…" : "https://…"}
            onChange={setLocation}
            onSubmit={(v) => onDone(engine ?? "claude", { kind, location: v || location })}
          />
        </Box>
      )}
    </Box>
  );
}
