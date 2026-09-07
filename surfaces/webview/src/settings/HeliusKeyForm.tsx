import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { useT } from "../i18n";
import { M } from "../i18n/messages";

// `emphasis` decides which action reads as primary. Settings > Helius and the market retry
// prompt exist to save a key, so "key" (the default) keeps Save Key green. The unlock
// tutorial's step 03 is optional and most users will never hold a Helius plan, so "skip"
// puts the green button on skipping, above the key path, with one reassurance line under
// it, and turns the link and Save Key gray (issue #219). Both variants call the same
// handlers; the layout and copy change, not the behavior.
export function HeliusKeyForm({ onDone, skipLabel = "Use Default", emphasis = "key" }: { onDone?: () => void; skipLabel?: string; emphasis?: "key" | "skip" }) {
  const { state, send } = useStore();
  const t = useT();
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [expectedTail, setExpectedTail] = useState<string | null>(null);
  const skipFirst = emphasis === "skip";

  useEffect(() => {
    if (saving && expectedTail && state.rpcStatus?.hasKey && state.rpcStatus.masked?.endsWith(expectedTail)) {
      setSaving(false);
      setExpectedTail(null);
      onDone?.();
    }
  }, [saving, expectedTail, state.rpcStatus, onDone]);

  function save() {
    const trimmed = key.trim();
    if (!trimmed) return;
    setSaving(true);
    setExpectedTail(trimmed.slice(-4));
    send({ type: "submitHeliusKey", key: trimmed });
  }

  function clear() {
    send({ type: "useDefaultRpc" });
    onDone?.();
  }

  return (
    <div className="flex flex-col gap-3">
      {skipFirst && (
        <>
          <button onClick={clear} className="an-btn an-btn-green w-full">
            {skipLabel}
          </button>
          <p className="text-center text-caption leading-relaxed text-[color:var(--an-fg-mute)]">{t(M.unlock.rpc.skipNote)}</p>
        </>
      )}
      <p className="text-xs leading-relaxed text-zinc-500">
        Stored locally, never synced. Speeds up NFT indexing, agent lists, and skill search.
      </p>
      {state.rpcStatus?.hasKey && (
        <div className="an-term-mono border border-[color:var(--an-green-line)] bg-[color:var(--an-green-dim)] px-3 py-2 text-[11px] text-[color:var(--an-green)]">
          {state.rpcStatus.network} · {state.rpcStatus.masked}
        </div>
      )}
      <label className="an-term-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--an-fg-dim)]">
        &gt;HELIUS_API_KEY<span className="unlock-cursor">_</span>
      </label>
      <input
        className="an-term-mono w-full border border-[color:var(--an-line)] bg-[color:var(--an-bg-1)] px-3 py-3 text-sm text-[color:var(--an-fg)] placeholder-[color:var(--an-fg-mute)] focus:border-[color:var(--an-green-line)] focus:outline-none"
        placeholder="paste key or rpc url"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        type="password"
      />
      <a
        href="https://www.helius.dev/docs/quickstart"
        target="_blank"
        rel="noreferrer"
        className={`an-term-mono text-[10px] font-bold uppercase tracking-[0.12em] active:opacity-70 ${skipFirst ? "text-[color:var(--an-fg-dim)]" : "text-[color:var(--an-green)]"}`}
      >
        &gt; Get_your_key · helius.dev
      </a>
      <button
        onClick={save}
        disabled={saving || !key.trim()}
        className={`an-btn mt-1 w-full disabled:opacity-50 ${skipFirst ? "an-btn-outline" : "an-btn-green"}`}
      >
        {saving ? "Saving…" : "Save Key"}
      </button>
      {!skipFirst && (
        <button
          onClick={clear}
          className="an-term-mono min-h-11 w-full text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--an-fg-dim)] active:opacity-70"
        >
          &gt; {skipLabel}
        </button>
      )}
    </div>
  );
}

export function HeliusSetupPanel({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col h-full bg-zinc-950">
      <header className="flex items-center gap-2 border-b border-zinc-800 px-2.5 shrink-0" style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))", paddingBottom: "0.55rem" }}>
        <button onClick={onBack} className="an-iconbtn shrink-0" aria-label="Back"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg></button>
        <span className="text-[15px] font-medium">Helius API Key</span>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        <HeliusKeyForm onDone={onBack} />
      </div>
    </div>
  );
}
