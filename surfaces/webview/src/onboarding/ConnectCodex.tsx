// Codex onboarding — mirrors ConnectClaude but offers two auth paths:
//   ChatGPT plan: device-auth (URL + one-time code, CLI auto-polls, no paste-back)
//   API key:      paste an sk-proj-... key, stored device-local, passed as OPENAI_API_KEY

import { useState } from "react";
import { OnboardingShell, OnboardingButton } from "./OnboardingShell";
import { useStore } from "../state/store";

type AuthMethod = "choose" | "chatgpt" | "apikey";

export function ConnectCodex() {
  const { state, send } = useStore();
  const { codexLoginUrl, codexLoginCode, codexLoginError } = state;
  const [method, setMethod] = useState<AuthMethod>("choose");
  const [apiKey, setApiKey] = useState("");
  const [copied, setCopied] = useState(false);

  function startDeviceAuth() {
    setMethod("chatgpt");
    send({ type: "startCodexLogin" });
  }

  async function copyUrl() {
    if (!codexLoginUrl) return;
    try {
      await navigator.clipboard.writeText(codexLoginUrl);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = codexLoginUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function submitApiKey() {
    const key = apiKey.trim();
    if (!key) return;
    send({ type: "saveCodexApiKey", key });
  }

  // ── choose auth method ──────────────────────────────────────────────────────
  if (method === "choose") {
    return (
      <OnboardingShell
        title="Connect Codex"
        subtitle="How do you want to sign in?"
      >
        <OnboardingButton onClick={startDeviceAuth}>
          ChatGPT plan — device auth
        </OnboardingButton>
        <OnboardingButton variant="outline" onClick={() => setMethod("apikey")}>
          OpenAI API key
        </OnboardingButton>
      </OnboardingShell>
    );
  }

  // ── API key entry ───────────────────────────────────────────────────────────
  if (method === "apikey") {
    return (
      <OnboardingShell
        title="OpenAI API Key"
        subtitle="Stored device-local. Used as OPENAI_API_KEY when Codex runs."
      >
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitApiKey()}
          placeholder="sk-proj-..."
          className="rounded-xl bg-zinc-900 px-3 py-3 text-sm font-mono text-white outline-none ring-1 ring-zinc-800 focus:ring-[#00E673]/50"
        />
        <OnboardingButton disabled={!apiKey.trim()} onClick={submitApiKey}>
          Save key
        </OnboardingButton>
        <OnboardingButton variant="outline" onClick={() => setMethod("choose")}>
          Back
        </OnboardingButton>
        {codexLoginError && (
          <p className="text-center text-sm text-red-400">{codexLoginError}</p>
        )}
      </OnboardingShell>
    );
  }

  // ── ChatGPT device-auth ─────────────────────────────────────────────────────
  return (
    <OnboardingShell
      title="Connect Codex"
      subtitle="Sign in with your ChatGPT subscription."
    >
      {!codexLoginUrl && !codexLoginError && (
        <p className="text-center text-sm text-zinc-500">Starting sign-in…</p>
      )}
      {codexLoginUrl && (
        <>
          <p className="text-sm text-zinc-400">1. Open this link and sign in:</p>
          <a
            href={codexLoginUrl}
            target="_blank"
            rel="noreferrer"
            className="break-all rounded-lg bg-zinc-900 px-3 py-2.5 text-xs leading-relaxed text-[#00E673] ring-1 ring-zinc-800"
          >
            {codexLoginUrl}
          </a>
          <OnboardingButton variant="outline" onClick={copyUrl}>
            {copied ? "Copied!" : "Copy link"}
          </OnboardingButton>
          <p className="mt-1 text-sm text-zinc-400">2. Enter this code on the page:</p>
          <div className="rounded-xl bg-zinc-900 px-4 py-3 text-center font-mono text-lg font-semibold tracking-widest text-[#00E673] ring-1 ring-zinc-800">
            {codexLoginCode}
          </div>
          <p className="text-center text-xs text-zinc-500">
            Waiting — continues automatically once you approve.
          </p>
        </>
      )}
      {codexLoginError && (
        <p className="text-center text-sm text-red-400">{codexLoginError}</p>
      )}
    </OnboardingShell>
  );
}
