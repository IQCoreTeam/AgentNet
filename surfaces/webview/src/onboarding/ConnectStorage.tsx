import { useState, useEffect } from "react";
import { OnboardingShell, OnboardingButton } from "./OnboardingShell";
import { useStore } from "../state/store";

export function ConnectStorage() {
  const { state, send, finishStorage } = useStore();
  const { googleLoginUrl, googleLoginError, googleCredsError, storage } = state;

  const [selectedKind, setSelectedKind] = useState<"gdrive" | "custom" | "local" | null>(null);
  const [customUrl, setCustomUrl] = useState("");
  const [customAuth, setCustomAuth] = useState("");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [savingCreds, setSavingCreds] = useState(false);

  // Auto-detect already connected storage
  const info = storage?.info as { kind?: string; connected?: boolean; account?: string } | null;
  const isCloudConnected = !!(info && info.connected && info.kind !== "local");
  const googleCredsConfigured = storage?.googleCredsConfigured ?? false;

  useEffect(() => {
    if (isCloudConnected && info?.kind) {
      setSelectedKind(info.kind as "gdrive" | "custom");
    }
  }, [isCloudConnected, info]);

  // Once creds are saved, clear the saving state
  useEffect(() => {
    if (googleCredsConfigured) setSavingCreds(false);
  }, [googleCredsConfigured]);

  async function copyUrl() {
    if (!googleLoginUrl) return;
    try {
      await navigator.clipboard.writeText(googleLoginUrl);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = googleLoginUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function startGoogleOAuth() {
    setBusy(true);
    send({ type: "startGoogleLogin" });
  }

  function submitGoogleCode() {
    if (!code.trim()) return;
    send({ type: "googleAuthCode", code: code.trim() });
    setCode("");
  }

  function submitGoogleCreds() {
    if (!clientId.trim() || !clientSecret.trim()) return;
    setSavingCreds(true);
    send({ type: "setGoogleCredentials", clientId: clientId.trim(), clientSecret: clientSecret.trim() });
  }

  function connectCustom() {
    if (!customUrl.trim()) return;
    send({
      type: "connectCloud",
      kind: "custom",
      location: customUrl.trim(),
      authHeader: customAuth.trim() || undefined,
    });
    finishStorage();
  }

  function handleDisconnect() {
    send({ type: "disconnectCloud" });
  }

  return (
    <OnboardingShell
      title="Session Storage"
      subtitle="Your sessions are always stored locally. Mirror them to a cloud to sync across devices."
    >
      {!selectedKind ? (
        <div className="flex flex-col gap-2.5">
          <OnboardingButton variant="outline" onClick={() => setSelectedKind("gdrive")}>
            Google Drive
          </OnboardingButton>
          <OnboardingButton variant="outline" onClick={() => setSelectedKind("custom")}>
            Custom (S3 / WebDAV / HTTP)
          </OnboardingButton>
          <OnboardingButton variant="outline" onClick={() => setSelectedKind("local")}>
            Keep on this device only
          </OnboardingButton>
        </div>
      ) : selectedKind === "local" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-400">
            Sessions will remain local to this device. You can configure a cloud mirror later in settings.
          </p>
          <OnboardingButton onClick={finishStorage}>Continue</OnboardingButton>
          <OnboardingButton variant="outline" onClick={() => setSelectedKind(null)}>
            Back
          </OnboardingButton>
        </div>
      ) : selectedKind === "custom" ? (
        <div className="flex flex-col gap-3">
          <label className="text-xs text-zinc-500 font-semibold uppercase">Endpoint URL</label>
          <input
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder="https://..."
            className="rounded-xl bg-zinc-900 px-3 py-3 text-sm text-white outline-none ring-1 ring-zinc-800 focus:ring-[#00E673]/50"
          />
          <label className="text-xs text-zinc-500 font-semibold uppercase">Auth Header (optional)</label>
          <input
            value={customAuth}
            onChange={(e) => setCustomAuth(e.target.value)}
            placeholder="Bearer token..."
            className="rounded-xl bg-zinc-900 px-3 py-3 text-sm text-white outline-none ring-1 ring-zinc-800 focus:ring-[#00E673]/50"
          />
          <OnboardingButton disabled={!customUrl.trim()} onClick={connectCustom}>
            Connect Storage
          </OnboardingButton>
          <OnboardingButton variant="outline" onClick={() => setSelectedKind(null)}>
            Back
          </OnboardingButton>
        </div>
      ) : (
        /* Google Drive */
        <div className="flex flex-col gap-3">
          {info?.kind === "gdrive" && info?.connected ? (
            <>
              <p className="text-sm text-zinc-300 text-center">
                ✓ Google Drive Connected
                {info.account && <span className="block text-xs text-zinc-500">({info.account})</span>}
              </p>
              <OnboardingButton onClick={finishStorage}>Continue</OnboardingButton>
              <OnboardingButton variant="outline" onClick={handleDisconnect}>
                Disconnect
              </OnboardingButton>
            </>
          ) : !googleCredsConfigured ? (
            /* Step 1: collect OAuth app credentials */
            <>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Create a <strong className="text-zinc-200">Desktop app</strong> OAuth client in{" "}
                <span className="text-[#00E673]">Google Cloud Console</span> and paste the credentials below.
              </p>
              <label className="text-xs text-zinc-500 font-semibold uppercase">Client ID</label>
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="123456789-xxx.apps.googleusercontent.com"
                className="rounded-xl bg-zinc-900 px-3 py-3 text-sm text-white outline-none ring-1 ring-zinc-800 focus:ring-[#00E673]/50"
              />
              <label className="text-xs text-zinc-500 font-semibold uppercase">Client Secret</label>
              <input
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="GOCSPX-..."
                type="password"
                className="rounded-xl bg-zinc-900 px-3 py-3 text-sm text-white outline-none ring-1 ring-zinc-800 focus:ring-[#00E673]/50"
              />
              {googleCredsError && (
                <p className="text-center text-sm text-red-400">{googleCredsError}</p>
              )}
              <OnboardingButton
                disabled={!clientId.trim() || !clientSecret.trim() || savingCreds}
                onClick={submitGoogleCreds}
              >
                {savingCreds ? "Saving…" : "Save & Continue"}
              </OnboardingButton>
              <OnboardingButton variant="outline" onClick={() => setSelectedKind(null)}>
                Back
              </OnboardingButton>
            </>
          ) : !googleLoginUrl ? (
            /* Step 2: OAuth sign-in */
            <>
              <OnboardingButton disabled={busy} onClick={startGoogleOAuth}>
                {busy ? "Starting Login…" : "Sign in to Google Drive"}
              </OnboardingButton>
              {googleLoginError && (
                <p className="text-center text-sm text-red-400">{googleLoginError}</p>
              )}
              <OnboardingButton variant="outline" onClick={() => setSelectedKind(null)}>
                Back
              </OnboardingButton>
            </>
          ) : (
            /* Step 3: paste auth code */
            <>
              <p className="text-xs text-zinc-400">
                1. Open this link and authorize Google Drive access:
              </p>
              <a
                href={googleLoginUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all rounded-lg bg-zinc-900 px-3 py-2.5 text-xs leading-relaxed text-[#00E673] ring-1 ring-zinc-800"
              >
                {googleLoginUrl}
              </a>
              <OnboardingButton variant="outline" onClick={copyUrl}>
                {copied ? "Copied!" : "Copy link"}
              </OnboardingButton>
              <p className="mt-1 text-xs text-zinc-400">
                2. Paste the redirected URL or authorization code back:
              </p>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitGoogleCode()}
                placeholder="Paste code or redirect URL here"
                className="rounded-xl bg-zinc-900 px-3 py-3 text-sm text-white outline-none ring-1 ring-zinc-800 focus:ring-[#00E673]/50"
              />
              <OnboardingButton disabled={!code.trim()} onClick={submitGoogleCode}>
                Confirm
              </OnboardingButton>
              <OnboardingButton
                variant="outline"
                onClick={() => {
                  send({ type: "cancelGoogleLogin" });
                  setBusy(false);
                }}
              >
                Cancel
              </OnboardingButton>
            </>
          )}
        </div>
      )}
    </OnboardingShell>
  );
}
