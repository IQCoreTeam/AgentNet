import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { openExternalUrl } from "../platform/openExternalUrl";
import { useAutoOpenExternalUrl } from "../platform/useAutoOpenExternalUrl";

// Compact Google Drive connect for the unlock tutorial's Cloud_Backup step. It mirrors the
// gdrive sub-flow of ConnectStorage (start OAuth, auto-open the URL, manual-code fallback,
// dev client-id entry) but trimmed to a single call-to-action plus a skip. Both a successful
// connect and a skip call onDone — the tutorial only needs to advance to the next step either
// way. It never calls finishStorage (that drives the onboarding phase, irrelevant in chat).
export function ConnectDriveForm({ onDone, skipLabel = "Skip for now" }: { onDone?: () => void; skipLabel?: string }) {
  const { state, send } = useStore();
  const { googleLoginUrl, googleLoginError, googleCredsError, storage } = state;
  const info = storage?.info as { kind?: string; connected?: boolean; account?: string } | null;
  const connected = !!(info && info.connected && info.kind !== "local");
  const credsConfigured = storage?.googleCredsConfigured ?? false;

  const [busy, setBusy] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState("");
  const [clientId, setClientId] = useState("");
  const [savingCreds, setSavingCreds] = useState(false);
  const advanced = useRef(false);

  useAutoOpenExternalUrl(googleLoginUrl);

  // Drive reported connected → advance exactly once.
  useEffect(() => {
    if (connected && !advanced.current) {
      advanced.current = true;
      onDone?.();
    }
  }, [connected, onDone]);
  useEffect(() => { if (googleLoginError) setBusy(false); }, [googleLoginError]);
  useEffect(() => { if (credsConfigured) setSavingCreds(false); }, [credsConfigured]);

  function start() { setBusy(true); setShowCode(false); send({ type: "startGoogleLogin" }); }
  function submitCode() { if (!code.trim()) return; send({ type: "googleAuthCode", code: code.trim() }); setCode(""); }
  function saveCreds() { if (!clientId.trim()) return; setSavingCreds(true); send({ type: "setGoogleCredentials", clientId: clientId.trim() }); }

  const input = "an-term-mono w-full border border-[color:var(--an-line)] bg-[color:var(--an-bg-1)] px-3 py-3 text-sm text-[color:var(--an-fg)] placeholder-[color:var(--an-fg-mute)] focus:border-[color:var(--an-green-line)] focus:outline-none";
  const skip = (
    <button
      type="button"
      onClick={() => onDone?.()}
      className="an-term-mono min-h-11 w-full text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--an-fg-dim)] active:opacity-70"
    >
      &gt; {skipLabel}
    </button>
  );

  // Dev builds ship without a bundled OAuth client id; collect one. Production builds have it,
  // so real users never see this branch and go straight to the connect button.
  if (!credsConfigured) {
    return (
      <div className="mt-6 flex flex-col gap-3">
        <p className="text-caption leading-relaxed text-[color:var(--an-fg-dim)]">
          This build has no Google client ID. Paste a Desktop OAuth client ID (development only).
        </p>
        <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="…apps.googleusercontent.com" className={input} />
        {googleCredsError && <p className="text-center text-caption text-red-400">{googleCredsError}</p>}
        <button type="button" onClick={saveCreds} disabled={!clientId.trim() || savingCreds} className="an-btn an-btn-green w-full disabled:opacity-50">
          {savingCreds ? "Saving…" : "Save & continue"}
        </button>
        {skip}
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-3">
      {!googleLoginUrl ? (
        <button type="button" onClick={start} disabled={busy} className="an-btn an-btn-green w-full disabled:opacity-60">
          {busy ? "Starting…" : "Connect Google Drive"}
        </button>
      ) : (
        <>
          <p className="text-body-dense leading-relaxed text-center text-[color:var(--an-fg-dim)]">
            Google sign-in opened in your browser. Approve Drive access, then return here.
          </p>
          <button type="button" onClick={() => openExternalUrl(googleLoginUrl)} className="an-btn an-btn-outline w-full">Open Google again</button>
          <button type="button" onClick={() => setShowCode((v) => !v)} className="an-term-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--an-fg-mute)] active:opacity-70">
            {showCode ? "Hide manual code" : "Trouble? Enter code manually"}
          </button>
          {showCode && (
            <>
              <input value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitCode()} placeholder="paste code or redirect url" className={input} />
              <button type="button" onClick={submitCode} disabled={!code.trim()} className="an-btn an-btn-green w-full disabled:opacity-50">Confirm</button>
            </>
          )}
        </>
      )}
      {googleLoginError && <p className="text-center text-caption text-red-400">{googleLoginError}</p>}
      {skip}
    </div>
  );
}
