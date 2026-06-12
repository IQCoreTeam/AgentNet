import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { Select, TextInput } from "@inkjs/ui";
import { STORAGE_OPTIONS, type StorageConfig, type StorageKind, startCodexLogin, markCodexConnected } from "@iqlabs-official/agent-sdk";
import type { CliReport, CliStatus } from "@iqlabs-official/agent-sdk";
import { colors, glyph } from "../theme.js";
import { Iggy } from "../components/Iggy.js";

// First-run setup. Sequence: engine pick → codex login (if needed) → storage.
//
// Engine pick: Claude or Codex. Both work end-to-end. Claude has no onboarding
// login step here (user runs `claude auth login` separately if needed — detectCli
// reports status up front). Codex with no-login status drives `codex login
// --device-auth` inline: shows URL + one-time code; CLI auto-polls, no stdin needed.
function statusBadge(s: CliStatus) {
  if (s === "ok") return <Text color={colors.ok}>{glyph.ok} ready</Text>;
  if (s === "no-login") return <Text color={colors.warn}>! not logged in</Text>;
  return <Text color={colors.err}>{glyph.fail} not installed</Text>;
}

type OnboardStep = "engine" | "codexLogin" | "storage" | "location";

export function Onboarding({
  report,
  address,
  onDone,
}: {
  report: CliReport;
  address: string;
  onDone: (engine: "claude" | "codex", cfg?: StorageConfig) => void;
}) {
  const [step, setStep] = useState<OnboardStep>("engine");
  const [engine, setEngine] = useState<"claude" | "codex">("claude");
  const [kind, setKind] = useState<StorageKind | null>(null);
  const [location, setLocation] = useState("");

  // codex device-auth state
  const [codexUrl, setCodexUrl] = useState<string | null>(null);
  const [codexCode, setCodexCode] = useState<string | null>(null);
  const [codexErr, setCodexErr] = useState<string | null>(null);

  function chooseEngine(e: "claude" | "codex") {
    setEngine(e);
    if (e === "codex" && report.codex === "no-login") {
      setStep("codexLogin");
    } else {
      setStep("storage");
    }
  }

  // drive `codex login --device-auth` when the codexLogin step becomes active.
  useEffect(() => {
    if (step !== "codexLogin") return;
    let cancelled = false;
    startCodexLogin().then((login) => {
      if (cancelled) { login.cancel(); return; }
      setCodexUrl(login.url);
      setCodexCode(login.code);
      login.done.then(async (ok) => {
        if (cancelled) return;
        if (ok) {
          await markCodexConnected();
          setStep("storage");
        } else {
          setCodexErr("Login failed or timed out. Re-open to try again.");
        }
      });
    }).catch((e: unknown) => {
      if (!cancelled) setCodexErr((e instanceof Error ? e.message : String(e)));
    });
    return () => { cancelled = true; };
  }, [step]);

  function chooseKind(k: StorageKind) {
    if (k === "local") return onDone(engine);
    if (k === "gdrive") return onDone(engine, { kind: "gdrive" });
    setKind(k);
    setStep("location");
  }

  return (
    <Box flexDirection="column" paddingX={1} gap={1}>
      <Box>
        <Iggy mood="idle" />
        <Text bold color={colors.iqMagenta}>{" "}welcome to AgentNet</Text>
      </Box>
      <Text dimColor>wallet {address.slice(0, 6)}…{address.slice(-4)}</Text>

      <Box flexDirection="column">
        <Box><Text>claude </Text>{statusBadge(report.claude)}</Box>
        <Box><Text>codex&nbsp; </Text>{statusBadge(report.codex)}</Box>
      </Box>

      {step === "engine" && (
        <Box flexDirection="column">
          <Text color={colors.iqCyan}>which engine do you want to use?</Text>
          <Select
            options={[
              { label: "Claude", value: "claude" },
              { label: "Codex", value: "codex" },
            ]}
            onChange={(v) => chooseEngine(v as "claude" | "codex")}
          />
        </Box>
      )}

      {step === "codexLogin" && (
        <Box flexDirection="column" gap={1}>
          <Text color={colors.iqCyan}>sign in to Codex with ChatGPT</Text>
          {!codexUrl && !codexErr && <Text dimColor>starting device auth…</Text>}
          {codexUrl && (
            <>
              <Text>1. open in browser:</Text>
              <Text color={colors.iqCyan}>{codexUrl}</Text>
              <Text>2. enter this code on the page:</Text>
              <Text bold color={colors.iqCyan}>{codexCode}</Text>
              <Text dimColor>waiting for approval…</Text>
            </>
          )}
          {codexErr && <Text color={colors.err}>{codexErr}</Text>}
        </Box>
      )}

      {step === "storage" && (
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
      )}

      {step === "location" && kind && (
        <Box flexDirection="column">
          <Text color={colors.iqCyan}>
            {kind === "icloud" ? "iCloud folder path:" : "endpoint base URL:"}
          </Text>
          <TextInput
            placeholder={kind === "icloud" ? "~/Library/Mobile Documents/…" : "https://…"}
            onChange={setLocation}
            onSubmit={(v) => onDone(engine, { kind, location: v || location })}
          />
        </Box>
      )}
    </Box>
  );
}
