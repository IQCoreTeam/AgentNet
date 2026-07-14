import { useEffect, useState } from "react";
import { useStore } from "../state/store";

export function HeliusKeyForm({ onDone, skipLabel = "Use Default" }: { onDone?: () => void; skipLabel?: string }) {
  const { state, send } = useStore();
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [expectedTail, setExpectedTail] = useState<string | null>(null);

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
        className="an-term-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--an-green)] active:opacity-70"
      >
        &gt; Get_your_key · helius.dev
      </a>
      <button
        onClick={save}
        disabled={saving || !key.trim()}
        className="an-btn an-btn-green mt-1 w-full disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save Key"}
      </button>
      <button
        onClick={clear}
        className="an-term-mono min-h-11 w-full text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--an-fg-dim)] active:opacity-70"
      >
        &gt; {skipLabel}
      </button>
    </div>
  );
}

export function HeliusSetupPanel({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col h-full bg-zinc-950">
      <header className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 shrink-0" style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}>
        <button onClick={onBack} className="text-zinc-400 active:text-zinc-200 px-1 text-lg">←</button>
        <span className="font-medium text-sm">Helius API Key</span>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        <HeliusKeyForm onDone={onBack} />
      </div>
    </div>
  );
}
