// Second onboarding screen (after wallet): connect the user's Claude subscription. The
// whole point of AgentNet is running on YOUR subscription, so this is where they sign in
// to Claude — not with an API key. The server runs `claude auth login --claudeai`, sends
// us the OAuth URL, the user opens it in their phone browser, authorizes, and pastes the
// returned code back; the CLI then holds the credentials device-local. We never see the
// token.

import { useState } from "react";
import { OnboardingShell, OnboardingButton } from "./OnboardingShell";
import { LoginUrlBlock } from "./LoginUrlBlock";
import { useStore } from "../state/store";

export function ConnectClaude() {
  const { state, send } = useStore();
  const { claudeLoginUrl, claudeLoginError } = state;
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");

  function start() {
    setBusy(true);
    send({ type: "startClaudeLogin" });
  }

  function submit() {
    if (!code.trim()) return;
    send({ type: "claudeAuthCode", code: code.trim() });
    setCode("");
  }

  return (
    <OnboardingShell
      title="Connect Claude"
      subtitle="Sign in with your Claude subscription to run agents on your plan."
    >
      {!claudeLoginUrl ? (
        <>
          <OnboardingButton disabled={busy} onClick={start}>
            {busy ? "Opening sign-in…" : "Connect Claude"}
          </OnboardingButton>
          {claudeLoginError && (
            <p className="text-center text-sm text-red-400">{claudeLoginError}</p>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-zinc-400">
            1. Open this link and authorize (here or on another device):
          </p>
          <LoginUrlBlock url={claudeLoginUrl} />
          <p className="mt-1 text-sm text-zinc-400">2. Paste the code you get back:</p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Paste code here"
            className="rounded-xl bg-zinc-900 px-3 py-3 text-sm text-white outline-none ring-1 ring-zinc-800 focus:ring-an-green/50"
          />
          <OnboardingButton disabled={!code.trim()} onClick={submit}>
            Confirm
          </OnboardingButton>
        </>
      )}
    </OnboardingShell>
  );
}
