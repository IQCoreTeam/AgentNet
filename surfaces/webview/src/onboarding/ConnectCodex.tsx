// Sign in with the user's ChatGPT plan (device auth) by default. An OpenAI API key is an
// ADVANCED fallback, hidden behind a "Use an API key instead" affordance - it is not the
// default mental model for normal users.
//
// IMPORTANT: an API key does NOT bypass the Codex CLI install. This screen is only reached
// once the Codex CLI is installed (status "no-login"); both the ChatGPT-plan and API-key
// paths configure that already-installed local CLI. The copy says so explicitly.
//
// If a key is entered, we reassure that it stays local and clear it from component state
// immediately after submit.

import { useState } from "react";
import { OnboardingShell, OnboardingButton } from "./OnboardingShell";
import { useStore } from "../state/store";

export function ConnectCodex() {
  const { state, send } = useStore();
  const { codexLoginUrl, codexLoginCode, codexLoginError } = state;
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Default to the plan sign-in; the API key form is revealed only on request (advanced).
  const [advanced, setAdvanced] = useState(false);
  const [apiKey, setApiKey] = useState("");

  function start() {
    setBusy(true);
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
    if (!apiKey.trim()) return;
    setBusy(true);
    send({ type: "submitCodexApiKey", key: apiKey.trim() });
    setApiKey(""); // clear from React state immediately; don't let the key linger in memory
  }

  return (
    <OnboardingShell
      title="Sign in to Codex"
      subtitle="Use your ChatGPT plan - no API key needed for most people."
    >
      {!advanced ? (
        <>
          {!codexLoginUrl ? (
            <>
              <OnboardingButton disabled={busy} onClick={start}>
                {busy ? "Starting sign-in..." : "Use your ChatGPT plan"}
              </OnboardingButton>
              <p className="text-center text-xs leading-relaxed text-zinc-500">
                Runs the Codex CLI on this device with your ChatGPT sign-in. AgentNet never
                sees your password.
              </p>
              {codexLoginError && (
                <p className="text-center text-sm text-red-400">{codexLoginError}</p>
              )}
              <button
                onClick={() => {
                  setAdvanced(true);
                  setBusy(false);
                }}
                className="mt-1 text-center text-xs text-zinc-500 hover:text-zinc-300"
              >
                Use an API key instead (advanced)
              </button>
            </>
          ) : (
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
              <p className="mt-1 text-sm text-zinc-400">2. Enter this one-time code on the page:</p>
              <div className="rounded-xl bg-zinc-900 px-4 py-3 text-center font-mono text-lg font-semibold tracking-widest text-[#00E673] ring-1 ring-zinc-800">
                {codexLoginCode}
              </div>
              <p className="text-center text-xs text-zinc-500">
                Waiting for approval - this finishes automatically once you enter the code.
              </p>
            </>
          )}
        </>
      ) : (
        <>
          <p className="text-xs leading-relaxed text-zinc-400">
            Advanced: use your own OpenAI API key with the Codex CLI on this device. The
            Codex CLI must still be installed - an API key does not replace it; it only
            changes how the installed CLI authenticates.
          </p>
          <input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitApiKey()}
            placeholder="sk-proj-..."
            type="password"
            className="rounded-xl bg-zinc-900 px-3 py-3 text-sm text-white outline-none ring-1 ring-zinc-800 focus:ring-[#00E673]/50"
          />
          <p className="text-xs leading-relaxed text-zinc-500">
            Your API key is stored locally on this device and is never sent to AgentNet's
            servers.
          </p>
          <OnboardingButton disabled={busy || !apiKey.trim()} onClick={submitApiKey}>
            {busy ? "Saving..." : "Connect with API key"}
          </OnboardingButton>
          {codexLoginError && (
            <p className="text-center text-sm text-red-400">{codexLoginError}</p>
          )}
          <button
            onClick={() => {
              setAdvanced(false);
              setApiKey("");
              setBusy(false);
            }}
            className="text-center text-xs text-zinc-500 hover:text-zinc-300"
          >
            Back to ChatGPT plan sign-in
          </button>
        </>
      )}
    </OnboardingShell>
  );
}
