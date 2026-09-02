import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { PasswordInput, Select, TextInput } from "@inkjs/ui";
import open from "open";
import {
  detectCli,
  resolveEngineBin,
  startClaudeLogin,
  startCodexLogin,
  markClaudeConnected,
  markCodexConnected,
  ENGINE_INSTALL_COMMAND,
  CUSTOM_ENGINE_PRESETS,
  CUSTOM_ENGINE_EGRESS_WARNING,
  CUSTOM_ENGINE_TOOL_WARNING,
  saveCustomEngineConfig,
  clearCustomEngineConfig,
  maskedCustomEngine,
  type CustomEnginePreset,
  type EngineKey,
  type CliReport,
  type CliStatus,
  type ClaudeLogin,
  type CodexLogin,
} from "@iqlabs-official/agent-sdk";
import { colors, glyph } from "../theme.js";

type Step = "pick" | "claude" | "codex" | "custom" | "customManage" | "customRemove";

function statusText(s: CliStatus): { text: string; color: string } {
  if (s === "ok") return { text: `${glyph.ok} logged in`, color: colors.ok };
  if (s === "no-login") return { text: "not logged in", color: colors.warn };
  return { text: "not installed", color: colors.err };
}

// Connect form for a custom OpenAI-compatible endpoint (issue #209): preset pick, then
// base URL, API key, and model, saved to the device-local config store. One flow shared
// by the login gate and first-run onboarding, so the copy and fields can never drift.
// `replacing` marks a reconfigure of an existing endpoint: the stored key can never be
// shown back, so the form warns that saving replaces the whole config, key included.
export function CustomEngineForm({ onSaved, replacing }: { onSaved: () => void; replacing?: boolean }) {
  const [stage, setStage] = useState<"preset" | "baseUrl" | "key" | "model">("preset");
  const [preset, setPreset] = useState<CustomEnginePreset>(CUSTOM_ENGINE_PRESETS[0]);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function submitModel(model: string) {
    void saveCustomEngineConfig({
      baseUrl,
      apiKey,
      model,
      presetId: preset.id,
      label: preset.label,
    })
      .then(onSaved)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }

  return (
    <Box flexDirection="column">
      <Text dimColor>{CUSTOM_ENGINE_EGRESS_WARNING}</Text>
      <Text dimColor>{CUSTOM_ENGINE_TOOL_WARNING}</Text>
      {replacing ? (
        <Text color={colors.warn}>saving replaces the current endpoint, key included. The saved key cannot be shown back, so enter it again.</Text>
      ) : null}
      {stage === "preset" && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={colors.iqCyan}>pick an endpoint:</Text>
          <Select
            options={CUSTOM_ENGINE_PRESETS.map((p) => ({
              label: p.baseUrl ? `${p.label} (${p.baseUrl})` : p.label,
              value: p.id,
            }))}
            visibleOptionCount={CUSTOM_ENGINE_PRESETS.length}
            onChange={(id) => {
              const p = CUSTOM_ENGINE_PRESETS.find((x) => x.id === id);
              if (!p) return;
              setPreset(p);
              setStage("baseUrl");
            }}
          />
        </Box>
      )}
      {stage === "baseUrl" && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={colors.iqCyan}>base URL:</Text>
          <TextInput
            defaultValue={preset.baseUrl}
            placeholder="https://…/v1"
            onSubmit={(v) => {
              if (!v.trim()) return;
              setBaseUrl(v.trim());
              setStage("key");
            }}
          />
        </Box>
      )}
      {stage === "key" && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={colors.iqCyan}>API key:</Text>
          {/* PasswordInput masks the echo: a key pasted here must not sit readable in the
              terminal or its scrollback. The real value still lands in state untouched. */}
          <PasswordInput
            placeholder="sk-… (leave empty for a local endpoint)"
            onSubmit={(v) => {
              setApiKey(v.trim());
              setStage("model");
            }}
          />
        </Box>
      )}
      {stage === "model" && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={colors.iqCyan}>model:</Text>
          <Text dimColor>codex always sends a model id to the endpoint, so one must be chosen.</Text>
          <TextInput
            defaultValue={preset.defaultModel}
            placeholder="model id (required)"
            onSubmit={(v) => {
              if (!v.trim()) return;
              submitModel(v.trim());
            }}
          />
        </Box>
      )}
      {err ? <Box marginTop={1}><Text color={colors.err}>{err}</Text></Box> : null}
    </Box>
  );
}

// Startup login gate — shown when the engine chat is about to use isn't logged in.
// Pick claude or codex and run the official login inline: claude prints an OAuth URL
// and waits for the pasted code; codex device-auth shows URL + one-time code and
// auto-polls. A custom engine "logs in" by saving an endpoint config instead. Esc
// skips; chat still opens with whatever IS available.
export function LoginGate({
  report,
  prefer,
  onDone,
}: {
  report: CliReport;
  prefer: EngineKey;
  onDone: (report: CliReport, loggedIn?: EngineKey) => void;
}) {
  const [step, setStep] = useState<Step>("pick");
  const [err, setErr] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [codexCode, setCodexCode] = useState("");
  const [waiting, setWaiting] = useState(false);
  // masked view of the saved custom endpoint (host + dotted key tail); null when no
  // config exists, which doubles as the configured/not-configured flag.
  const [customMasked, setCustomMasked] = useState<string | null>(null);
  useEffect(() => {
    void maskedCustomEngine().then(setCustomMasked);
  }, []);
  const customConfigured = customMasked !== null;
  const claudeRef = useRef<ClaudeLogin | null>(null);
  const codexRef = useRef<CodexLogin | null>(null);
  const finishing = useRef(false);

  async function finish(engine?: EngineKey) {
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

  // Remove needs a deliberate second keypress: the config holds a key that cannot be
  // recovered once the file is gone, so a stray Enter must not be able to delete it.
  useInput((input) => {
    if (input !== "y" && input !== "Y") return;
    void clearCustomEngineConfig().then(() => {
      setCustomMasked(null);
      setStep("pick");
    });
  }, { isActive: step === "customRemove" });

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

  function pick(engine: EngineKey) {
    if (engine === "custom") {
      // custom rides the codex binary; the config store is its login.
      if (report.codex === "missing") {
        setErr(`custom engines run through the codex binary · run: ${ENGINE_INSTALL_COMMAND.custom}`);
        return;
      }
      // configured: land on the manage menu (use / reconfigure / remove) instead of
      // silently reusing a config whose key can never be inspected again.
      setStep(customConfigured ? "customManage" : "custom");
      return;
    }
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
  const customS =
    report.codex === "missing"
      ? { text: "needs the codex binary", color: colors.err }
      : customConfigured
        ? { text: `${glyph.ok} configured`, color: colors.ok }
        : { text: "not configured", color: colors.warn };

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
          <Box>
            <Box width={10}><Text bold color={colors.iqViolet}>custom</Text></Box>
            <Text color={customS.color}>{customS.text}</Text>
          </Box>
        </Box>
        <Box marginTop={1}>
          <Select
            defaultValue={prefer}
            options={[
              { label: "log in with claude", value: "claude" },
              { label: "log in with codex", value: "codex" },
              { label: customConfigured ? "use or manage the custom engine" : "connect a custom engine", value: "custom" },
              { label: "skip for now", value: "skip" },
            ]}
            onChange={(v) => {
              if (v === "skip") void finish();
              else pick(v as EngineKey);
            }}
          />
        </Box>
        {err ? <Box marginTop={1}><Text color={colors.err}>{err}</Text></Box> : null}
        <Box marginTop={1}><Text dimColor>↑/↓ move · ↵ select · esc skip</Text></Box>
      </Box>
    );
  }

  if (step === "customManage") {
    return (
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Text bold color={colors.iqViolet}>custom engine</Text>
        <Text dimColor>configured: {customMasked}</Text>
        <Box marginTop={1}>
          <Select
            options={[
              { label: "use this endpoint", value: "use" },
              { label: "reconfigure (saving replaces it)", value: "reconfigure" },
              { label: "remove this endpoint", value: "remove" },
            ]}
            onChange={(v) => {
              if (v === "use") void finish("custom");
              else if (v === "reconfigure") setStep("custom");
              else setStep("customRemove");
            }}
          />
        </Box>
        <Box marginTop={1}><Text dimColor>↑/↓ move · ↵ select · esc back</Text></Box>
      </Box>
    );
  }

  if (step === "customRemove") {
    return (
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Text bold color={colors.iqViolet}>remove custom engine</Text>
        <Text>delete the saved endpoint config ({customMasked})? The key inside is not recoverable.</Text>
        <Box marginTop={1}><Text dimColor>y remove · esc keep</Text></Box>
      </Box>
    );
  }

  if (step === "custom") {
    return (
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Text bold color={colors.iqViolet}>connect a custom engine</Text>
        <CustomEngineForm replacing={customConfigured} onSaved={() => void finish("custom")} />
        <Box marginTop={1}><Text dimColor>esc back</Text></Box>
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
