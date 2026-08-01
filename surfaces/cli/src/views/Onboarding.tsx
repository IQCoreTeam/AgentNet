import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { Select, TextInput } from "@inkjs/ui";
import { spawn } from "node:child_process";
import open from "open";
import { STORAGE_OPTIONS, type StorageConfig, type StorageKind, startCodexLogin, markCodexConnected, saveCodexApiKey, startGoogleLogin, type GoogleLogin, saveHeliusKey, HELIUS_QUICKSTART_URL, detectCli, ENGINE_INSTALL_COMMAND } from "@iqlabs-official/agent-sdk";
import type { CliReport, CliStatus } from "@iqlabs-official/agent-sdk";
import { colors, glyph } from "../theme.js";
import { Iggy } from "../components/Iggy.js";

// First-run setup. Sequence: engine pick → codex login (if needed) → storage → rpc.
//
// Engine pick: Claude or Codex. Both work end-to-end. Claude has no onboarding
// login step here (user runs `claude auth login` separately if needed — detectCli
// reports status up front). Codex with no-login status drives `codex login
// --device-auth` inline: shows URL + one-time code; CLI auto-polls, no stdin needed.
//
// RPC is the last step: every storage path (local/cloud/gdrive) funnels through it so the
// user is offered a Helius key once before landing in chat. Skipping = the default RPC.
function statusBadge(s: CliStatus) {
  if (s === "ok") return <Text color={colors.ok}>{glyph.ok} ready</Text>;
  if (s === "no-login") return <Text color={colors.warn}>! not logged in</Text>;
  return <Text color={colors.err}>{glyph.fail} not installed</Text>;
}

type OnboardStep = "engine" | "install" | "codexAuthChoice" | "codexLogin" | "codexApiKey" | "storage" | "location" | "gdriveLogin" | "rpc";

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
  // Live copy of the CLI report: the install step re-runs detectCli after installing an
  // engine, so the badges and routing reflect the new state without restarting the app.
  const [rep, setRep] = useState<CliReport>(report);
  const [kind, setKind] = useState<StorageKind | null>(null);
  const [location, setLocation] = useState("");
  // storage choice resolved but not yet applied — held while the final RPC step runs.
  const [pendingCfg, setPendingCfg] = useState<StorageConfig | undefined>(undefined);
  const [rpcErr, setRpcErr] = useState<string | null>(null);

  // Every storage path ends here: stash the chosen config and show the RPC step.
  function beginRpc(cfg?: StorageConfig) {
    setPendingCfg(cfg);
    setStep("rpc");
  }

  // Finish onboarding. A key persists to the local Helius store; empty = keep default RPC.
  async function finishRpc(key: string) {
    try {
      if (key.trim()) await saveHeliusKey(key.trim());
    } catch (e: unknown) {
      setRpcErr(e instanceof Error ? e.message : String(e));
      return;
    }
    onDone(engine, pendingCfg);
  }

  // codex device-auth state
  const [codexUrl, setCodexUrl] = useState<string | null>(null);
  const [codexCode, setCodexCode] = useState<string | null>(null);
  const [codexErr, setCodexErr] = useState<string | null>(null);

  // gdrive OAuth state
  const [gdriveUrl, setGdriveUrl] = useState<string | null>(null);
  const [gdriveErr, setGdriveErr] = useState<string | null>(null);
  const [googleSession, setGoogleSession] = useState<GoogleLogin | null>(null);
  const [busy, setBusy] = useState(false);

  // Route an engine pick from a given report (the live one, or the fresh one detectCli
  // returns right after an install): missing -> install step, codex without login ->
  // auth choice, otherwise -> storage.
  function routeEngine(e: "claude" | "codex", r: CliReport) {
    setEngine(e);
    if (r[e] === "missing") {
      setStep("install");
    } else if (e === "codex" && r.codex === "no-login") {
      setStep("codexAuthChoice");
    } else {
      setStep("storage");
    }
  }

  // install step state: run `npm install -g <engine>` inline with explicit consent,
  // streaming the tail of its output so the wait is visible, then re-detect.
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [installErr, setInstallErr] = useState<string | null>(null);

  function runInstall() {
    setInstalling(true);
    setInstallErr(null);
    setInstallLog([]);
    const child = spawn(ENGINE_INSTALL_COMMAND[engine], { shell: true, stdio: ["ignore", "pipe", "pipe"] });
    const append = (d: Buffer) => {
      const lines = d.toString().split("\n").map((s) => s.trim()).filter(Boolean);
      if (lines.length) setInstallLog((prev) => [...prev, ...lines].slice(-4));
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (e) => {
      setInstalling(false);
      setInstallErr(e.message);
    });
    child.on("exit", (code) => {
      void (async () => {
        const fresh = await detectCli();
        setRep(fresh);
        setInstalling(false);
        if (fresh[engine] === "missing") {
          setInstallErr(
            code === 0
              ? "install finished but the engine is still not detected; open a new terminal and check, or install manually"
              : `install failed (exit ${code}); run the command above manually to see the full output`,
          );
        } else {
          routeEngine(engine, fresh);
        }
      })();
    });
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

  async function submitApiKey(key: string) {
    if (!key.trim()) return;
    try {
      await saveCodexApiKey(key.trim());
      await markCodexConnected();
      setStep("storage");
    } catch (e: unknown) {
      setCodexErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (step !== "gdriveLogin") return;
    let activeSession: GoogleLogin | null = null;
    let cancelled = false;
    startGoogleLogin().then((session) => {
      if (cancelled) { session.cancel(); return; }
      activeSession = session;
      setGdriveUrl(session.url);
      setGoogleSession(session);
      // Auto-open the browser with the exact URL — copying it manually means copying a
      // ~300-char string that wraps across terminal lines below, which terminals routinely
      // mangle (silently truncated scope → Google's own "Error 400: invalid_scope"). The
      // wrapped text stays visible as a remote/SSH fallback, but auto-open is now primary.
      void open(session.url).catch(() => { /* no GUI browser available — falls back to the link/paste below */ });
      session.done.then((ok) => {
        if (cancelled) return;
        if (ok) {
          beginRpc({ kind: "gdrive" });
        } else {
          setGdriveErr(session.error ?? "Google sign-in was not completed.");
        }
      });
    }).catch((e: unknown) => {
      if (!cancelled) setGdriveErr(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
      if (activeSession) activeSession.cancel();
    };
  }, [step]);

  async function submitGdriveCode(codeVal: string) {
    if (!codeVal.trim() || !googleSession) return;
    try {
      await googleSession.submitCode(codeVal.trim());
    } catch (e: unknown) {
      setGdriveErr(e instanceof Error ? e.message : String(e));
    }
  }

  function chooseKind(k: StorageKind) {
    if (k === "local") return beginRpc();
    if (k === "gdrive") {
      setStep("gdriveLogin");
      return;
    }
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
        <Box><Text>claude </Text>{statusBadge(rep.claude)}</Box>
        <Box><Text>codex&nbsp; </Text>{statusBadge(rep.codex)}</Box>
      </Box>

      {step === "engine" && (
        <Box flexDirection="column">
          <Text color={colors.iqCyan}>which engine do you want to use?</Text>
          <Select
            options={[
              { label: "Claude", value: "claude" },
              { label: "Codex", value: "codex" },
            ]}
            onChange={(v) => routeEngine(v as "claude" | "codex", rep)}
          />
        </Box>
      )}

      {step === "install" && (
        <Box flexDirection="column">
          <Text color={colors.iqCyan}>{engine} is not installed. install it now?</Text>
          <Text dimColor>runs: {ENGINE_INSTALL_COMMAND[engine]}</Text>
          {!installing && (
            <Select
              options={[
                { label: "Yes, run the install here", value: "yes" },
                { label: "No, back to engine pick", value: "no" },
              ]}
              onChange={(v) => (v === "yes" ? runInstall() : setStep("engine"))}
            />
          )}
          {installing && (
            <Box flexDirection="column">
              {installLog.map((line, i) => <Text key={i} dimColor>{line}</Text>)}
              <Text color={colors.warn}>installing… this can take a minute</Text>
            </Box>
          )}
          {installErr && <Text color={colors.err}>{installErr}</Text>}
        </Box>
      )}

      {step === "codexAuthChoice" && (
        <Box flexDirection="column">
          <Text color={colors.iqCyan}>how do you want to connect to Codex?</Text>
          <Select
            options={[
              { label: "ChatGPT Plus Plan (uses device auth)", value: "chatgpt" },
              { label: "OpenAI API Key (uses direct API access)", value: "apikey" },
            ]}
            onChange={(v) => {
              if (v === "chatgpt") setStep("codexLogin");
              else setStep("codexApiKey");
            }}
          />
        </Box>
      )}

      {step === "codexApiKey" && (
        <Box flexDirection="column">
          <Text color={colors.iqCyan}>Enter your OpenAI API Key:</Text>
          <TextInput
            placeholder="sk-proj-..."
            onSubmit={submitApiKey}
          />
          {codexErr && <Text color={colors.err}>{codexErr}</Text>}
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
          <Text dimColor>(local is always on; a cloud just mirrors it)</Text>
          <Select
            options={STORAGE_OPTIONS.map((o) => ({
              label: `${o.label}: ${o.needs}`,
              value: o.kind,
            }))}
            onChange={(v) => chooseKind(v as StorageKind)}
          />
        </Box>
      )}

      {step === "gdriveLogin" && (
        <Box flexDirection="column" gap={1}>
          <Text color={colors.iqCyan}>sign in to Google Drive</Text>
          {!gdriveUrl && !gdriveErr && <Text dimColor>starting OAuth flow…</Text>}
          {gdriveUrl && (
            <>
              <Text>opening in your browser… approve access, then this closes on its own.</Text>
              <Text dimColor>didn't open? copy this link (avoid copying across a wrapped line):</Text>
              <Text color={colors.iqCyan}>{gdriveUrl}</Text>
              <Text>no GUI browser here? paste the redirected URL or code instead:</Text>
              <TextInput
                placeholder="Paste URL or code here"
                onSubmit={submitGdriveCode}
              />
            </>
          )}
          {gdriveErr && <Text color={colors.err}>{gdriveErr}</Text>}
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
            onSubmit={(v) => beginRpc({ kind, location: v || location })}
          />
        </Box>
      )}

      {step === "rpc" && (
        <Box flexDirection="column">
          <Text color={colors.iqCyan}>connect a Helius RPC? (optional)</Text>
          <Text dimColor>the default RPC can't read NFTs, agent lists, or skill search — a free key can.</Text>
          <Text dimColor>get a free key at <Text color={colors.iqCyan}>{HELIUS_QUICKSTART_URL}</Text></Text>
          <TextInput
            placeholder="paste key or rpc url — or [enter] to skip for now"
            onSubmit={finishRpc}
          />
          {rpcErr && <Text color={colors.err}>{rpcErr}</Text>}
        </Box>
      )}
    </Box>
  );
}
