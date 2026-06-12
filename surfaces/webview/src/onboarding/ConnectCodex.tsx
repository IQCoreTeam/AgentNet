// Codex device-auth onboarding screen. Mirrors ConnectClaude but simpler: the user
// opens a fixed URL and enters a one-time code shown here — no code pasted back, the
// CLI auto-polls until it sees the approval and the process exits 0.

import { useState } from "react";
import { OnboardingShell, OnboardingButton } from "./OnboardingShell";
import { useStore } from "../state/store";

export function ConnectCodex() {
  const { state, send } = useStore();
  const { codexLoginUrl, codexLoginCode, codexLoginError } = state;
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

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

  return (
    <OnboardingShell
      title="Connect Codex"
      subtitle="Sign in with your ChatGPT subscription to run Codex on your plan."
    >
      {!codexLoginUrl ? (
        <>
          <OnboardingButton disabled={busy} onClick={start}>
            {busy ? "Starting sign-in…" : "Connect Codex"}
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
          <p className="mt-1 text-sm text-zinc-400">
            2. Enter this one-time code on the page:
          </p>
          <div className="rounded-xl bg-zinc-900 px-4 py-3 text-center font-mono text-lg font-semibold tracking-widest text-[#00E673] ring-1 ring-zinc-800">
            {codexLoginCode}
          </div>
          <p className="text-center text-xs text-zinc-500">
            Waiting for approval — this happens automatically once you enter the code.
          </p>
        </>
      )}
    </OnboardingShell>
  );
}
