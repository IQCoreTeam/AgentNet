// Codex device-auth or API key onboarding screen. Renders tab selector at top
// and allows user to connect via either subscription auth or API key.

import { useState } from "react";
import { OnboardingShell, OnboardingButton } from "./OnboardingShell";
import { LoginUrlBlock } from "./LoginUrlBlock";
import { useStore } from "../state/store";

export function ConnectCodex() {
  const { state, send, showEngineSelect } = useStore();
  const { codexLoginUrl, codexLoginCode, codexLoginError } = state;
  const [busy, setBusy] = useState(false);

  const [method, setMethod] = useState<"chatgpt" | "apikey">("chatgpt");
  const [apiKey, setApiKey] = useState("");

  function start() {
    setBusy(true);
    send({ type: "startCodexLogin" });
  }

  function submitApiKey() {
    if (!apiKey.trim()) return;
    setBusy(true);
    send({ type: "submitCodexApiKey", key: apiKey.trim() });
    setApiKey(""); // clear from React state immediately; don't let key linger in memory
  }

  function close() {
    setBusy(false);
    send({ type: "cancelCodexLogin" });
    showEngineSelect();
  }

  return (
    <OnboardingShell
      title="Connect Codex"
      subtitle="Choose how you want to connect to the Codex engine."
      onClose={close}
      closeLabel="Close Codex connection"
    >
      <div className="flex gap-2 rounded-xl bg-zinc-950 p-1 ring-1 ring-zinc-850">
        <button
          onClick={() => {
            setMethod("chatgpt");
            setBusy(false);
          }}
          className={`flex-1 rounded-lg py-2 text-xs font-medium transition ${
            method === "chatgpt"
              ? "bg-zinc-800 text-white shadow-sm"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          ChatGPT Plan
        </button>
        <button
          onClick={() => {
            setMethod("apikey");
            setBusy(false);
          }}
          className={`flex-1 rounded-lg py-2 text-xs font-medium transition ${
            method === "apikey"
              ? "bg-zinc-800 text-white shadow-sm"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          API Key
        </button>
      </div>

      {method === "chatgpt" ? (
        <>
          {!codexLoginUrl ? (
            <>
              <p className="text-center text-xs text-zinc-400 leading-normal">
                Uses your ChatGPT Plus plan. This runs the Codex CLI locally with device-based authorization.
              </p>
              <OnboardingButton disabled={busy} onClick={start}>
                {busy ? "Starting sign-in…" : "Connect with ChatGPT Plan"}
              </OnboardingButton>
              {codexLoginError && (
                <p className="text-center text-sm text-red-400">{codexLoginError}</p>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-zinc-400">
                1. Open this link and sign in:
              </p>
              <LoginUrlBlock url={codexLoginUrl} />
              <p className="mt-1 text-sm text-zinc-400">
                2. Enter this one-time code on the page:
              </p>
              <div className="rounded-xl bg-zinc-900 px-4 py-3 text-center font-mono text-lg font-semibold tracking-widest text-an-green ring-1 ring-zinc-800">
                {codexLoginCode}
              </div>
              <p className="text-center text-xs text-zinc-500">
                Waiting for approval. This happens automatically once you enter the code.
              </p>
            </>
          )}
        </>
      ) : (
        <>
          <p className="text-center text-xs text-zinc-400 leading-normal">
            Connect using your own OpenAI API key.
          </p>
          <input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitApiKey()}
            placeholder="sk-proj-..."
            type="password"
            className="rounded-xl bg-zinc-900 px-3 py-3 text-sm text-white outline-none ring-1 ring-zinc-800 focus:ring-an-green/50"
          />
          <OnboardingButton disabled={busy || !apiKey.trim()} onClick={submitApiKey}>
            {busy ? "Saving…" : "Connect with API Key"}
          </OnboardingButton>
          {codexLoginError && (
            <p className="text-center text-sm text-red-400">{codexLoginError}</p>
          )}
        </>
      )}
    </OnboardingShell>
  );
}
