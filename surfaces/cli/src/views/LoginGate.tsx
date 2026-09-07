import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Select, TextInput } from "@inkjs/ui";
import open from "open";
import {
  detectCli,
  resolveEngineBin,
  startClaudeLogin,
  startCodexLogin,
  markClaudeConnected,
  markCodexConnected,
  ENGINE_INSTALL_COMMAND,
  type CliReport,
  type CliStatus,
  type ClaudeLogin,
  type CodexLogin,
} from "@iqlabs-official/agent-sdk";
import { colors, glyph } from "../theme.js";

type Step = "pick" | "claude" | "codex";

function statusText(s: CliStatus): { text: string; color: string } {
  if (s === "ok") return { text: `${glyph.ok} logged in`, color: colors.ok };
  if (s === "no-login") return { text: "not logged in", color: colors.warn };
  return { text: "not installed", color: colors.err };
}

// Startup login gate — shown when the engine chat is about to use isn't logged in.
// Pick claude or codex and run the official login inline: claude prints an OAuth URL
// and waits for the pasted code; codex device-auth shows URL + one-time code and
// auto-polls. Esc skips — chat still opens with whatever IS available.
export function LoginGate({
  report,
  prefer,
  onDone,
}: {
  report: CliReport;
  prefer: "claude" | "codex";
  onDone: (report: CliReport, loggedIn?: "claude" | "codex") => void;
}) {
  const [step, setStep] = useState<Step>("pick");
  const [err, setErr] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [codexCode, setCodexCode] = useState("");
  const [waiting, setWaiting] = useState(false);
  const claudeRef = useRef<ClaudeLogin | null>(null);
  const codexRef = useRef<CodexLogin | null>(null);
  const finishing = useRef(false);

  async function finish(engine?: "claude" | "codex") {
    if (finishing.current) return;
    finishing.current = true;
    onDone(await detectCli(), engine);
  }

  useInput((_input, key) => {
    if (!key.escape) return;
    if (step === "pick") {
      void finish();
    } else {
      claudeRef.current?.cancel();
      codexRef.current?.cancel();
      claudeRef.current = null;
      codexRef.current = null;
      setWaiting(false);
      setStep("pick");
    }
  });

  // claude: `claude auth login --claudeai` → browser OAuth → paste the code back.
  useEffect(() => {
    if (step !== "claude") return;
    let cancelled = false;
    setErr(null);
    setUrl("");
    startClaudeLogin(resolveEngineBin("claude"))
      .then((login) => {
        if (cancelled) return login.cancel();
        claudeRef.current = login;
        setUrl(login.url);
        void open(login.url).catch(() => {});
        void login.done.then(async (ok) => {
          if (cancelled) return;
          if (ok) {
            await markClaudeConnected().catch(() => {});
            void finish("claude");
          } else {
            setErr("claude login failed · try again");
            setWaiting(false);
            setStep("pick");
          }
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
        setStep("pick");
      });
    return () => {
      cancelled = true;
    };
  }, [step]);

  // codex: device auth — the CLI polls by itself, we just show the URL + code.
  useEffect(() => {
    if (step !== "codex") return;
    let cancelled = false;
    setErr(null);
    setUrl("");
    setCodexCode("");
    startCodexLogin(resolveEngineBin("codex"))
      .then((login) => {
        if (cancelled) return login.cancel();
        codexRef.current = login;
        setUrl(login.url);
        setCodexCode(login.code);
        void open(login.url).catch(() => {});
        void login.done.then(async (ok) => {
          if (cancelled) return;
          if (ok) {
            await markCodexConnected().catch(() => {});
            void finish("codex");
          } else {
            setErr("codex login failed · try again");
            setStep("pick");
          }
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
        setStep("pick");
      });
    return () => {
      cancelled = true;
    };
  }, [step]);

  function pick(engine: "claude" | "codex") {
    if (report[engine] === "missing") {
      setErr(`${engine} is not installed · run: ${ENGINE_INSTALL_COMMAND[engine]}`);
      return;
    }
    if (report[engine] === "ok") {
      void finish(engine);
      return;
    }
    setStep(engine);
  }

  const claudeS = statusText(report.claude);
  const codexS = statusText(report.codex);

  if (step === "pick") {
    return (
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Text bold color={colors.iqMagenta}>log in to continue</Text>
        <Text dimColor>no engine is signed in. Pick one to log in with</Text>
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Box width={10}><Text bold color={colors.claude}>claude</Text></Box>
            <Text color={claudeS.color}>{claudeS.text}</Text>
          </Box>
          <Box>
            <Box width={10}><Text bold color={colors.codex}>codex</Text></Box>
            <Text color={codexS.color}>{codexS.text}</Text>
          </Box>
        </Box>
        <Box marginTop={1}>
          <Select
            defaultValue={prefer}
            options={[
              { label: "log in with claude", value: "claude" },
              { label: "log in with codex", value: "codex" },
              { label: "skip for now", value: "skip" },
            ]}
            onChange={(v) => {
              if (v === "skip") void finish();
              else pick(v as "claude" | "codex");
            }}
          />
        </Box>
        {err ? <Box marginTop={1}><Text color={colors.err}>{err}</Text></Box> : null}
        <Box marginTop={1}><Text dimColor>↑/↓ move · ↵ select · esc skip</Text></Box>
      </Box>
    );
  }

  const tint = step === "codex" ? colors.codex : colors.claude;
  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Text bold color={tint}>{step} login</Text>
      {url ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>open this URL in your browser:</Text>
          <Text color={colors.iqCyan}>{url}</Text>
          {step === "codex" && codexCode ? (
            <Box marginTop={1}>
              <Text>one-time code: </Text>
              <Text bold color={colors.iqMagenta}>{codexCode}</Text>
            </Box>
          ) : null}
          {step === "claude" ? (
            waiting ? (
              <Box marginTop={1}><Text dimColor>checking the code…</Text></Box>
            ) : (
              <Box marginTop={1} flexDirection="column">
                <Text>paste the code from the browser:</Text>
                <TextInput
                  placeholder="code…"
                  onSubmit={(code) => {
                    if (!code.trim()) return;
                    setWaiting(true);
                    claudeRef.current?.submitCode(code);
                  }}
                />
              </Box>
            )
          ) : (
            <Box marginTop={1}><Text dimColor>waiting for the browser sign-in…</Text></Box>
          )}
        </Box>
      ) : (
        <Box marginTop={1}><Text dimColor>starting {step} login…</Text></Box>
      )}
      <Box marginTop={1}><Text dimColor>esc back</Text></Box>
    </Box>
  );
}
