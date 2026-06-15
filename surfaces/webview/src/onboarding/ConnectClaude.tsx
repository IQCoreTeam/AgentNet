// Sign in with the user's Claude plan. The whole point of AgentNet is running on YOUR
// subscription, so this is a plan sign-in, not an API key. The server runs the Claude CLI
// login, sends us the OAuth URL, the user opens it, authorizes, and pastes the returned
// code back; the CLI then holds the credentials device-local. We never see the token.

import { useState } from "react";
import { OnboardingShell, OnboardingButton } from "./OnboardingShell";
import { useStore } from "../state/store";

export function ConnectClaude() {
  const { state, send } = useStore();
  const { claudeLoginUrl, claudeLoginError } = state;
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);

  function start() {
    setBusy(true);
    send({ type: "startClaudeLogin" });
  }

  // Copy the OAuth URL so the user can authorize on ANOTHER device (e.g. a desktop where
  // they're already signed into Claude) and just paste the code back here.
  async function copyUrl() {
    if (!claudeLoginUrl) return;
    try {
      await navigator.clipboard.writeText(claudeLoginUrl);
    } catch {
      // clipboard API can be blocked; fall back to a hidden textarea + execCommand
      const ta = document.createElement("textarea");
      ta.value = claudeLoginUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function submit() {
    if (!code.trim()) return;
    send({ type: "claudeAuthCode", code: code.trim() });
    setCode("");
  }

  return (
    <OnboardingShell
      title="Sign in to Claude"
      subtitle="Use your Claude plan - no API key needed. AgentNet runs on your existing subscription."
    >
      {!claudeLoginUrl ? (
        <>
          <OnboardingButton disabled={busy} onClick={start}>
            {busy ? "Opening sign-in..." : "Use your Claude plan"}
          </OnboardingButton>
          <p className="text-center text-xs leading-relaxed text-zinc-500">
            Your Claude login stays in the CLI on this device. AgentNet never sees your
            password or token.
          </p>
          {claudeLoginError && (
            <p className="text-center text-sm text-red-400">{claudeLoginError}</p>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-zinc-400">
            1. Open this link and approve access (here or on another device):
          </p>
          <a
            href={claudeLoginUrl}
            target="_blank"
            rel="noreferrer"
            className="break-all rounded-lg bg-zinc-900 px-3 py-2.5 text-xs leading-relaxed text-[#00E673] ring-1 ring-zinc-800"
          >
            {claudeLoginUrl}
          </a>
          <OnboardingButton variant="outline" onClick={copyUrl}>
            {copied ? "Copied!" : "Copy link"}
          </OnboardingButton>
          <p className="mt-1 text-sm text-zinc-400">2. Paste the code you get back:</p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Paste code here"
            className="rounded-xl bg-zinc-900 px-3 py-3 text-sm text-white outline-none ring-1 ring-zinc-800 focus:ring-[#00E673]/50"
          />
          <OnboardingButton disabled={!code.trim()} onClick={submit}>
            Confirm
          </OnboardingButton>
        </>
      )}
    </OnboardingShell>
  );
}
