import { useEffect, useState } from "react";
import { useStore } from "../state/store";

export function HeliusKeyForm({ onDone }: { onDone?: () => void }) {
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
      <p className="text-sm text-zinc-400">
        A Helius key powers fast NFT indexing, agent lists, and skill search. It is stored locally and never synced.
      </p>
      <a
        href="https://www.helius.dev/docs/quickstart"
        target="_blank"
        rel="noreferrer"
        className="text-xs font-medium text-[#00E673] active:text-[#00d068]"
      >
        Helius quickstart
      </a>
      {state.rpcStatus?.hasKey && (
        <div className="rounded-lg border border-green-800/40 bg-green-900/10 px-3 py-2 text-xs text-green-500">
          {state.rpcStatus.network} · {state.rpcStatus.masked}
        </div>
      )}
      <input
        className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-green-500/50 font-mono"
        placeholder="xxxx-xxxx-xxxx or https://…helius-rpc.com/?api-key=…"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        type="password"
      />
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving || !key.trim()}
          className="flex-1 rounded-xl bg-green-600 py-2.5 text-sm font-semibold text-white active:bg-green-500 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Key"}
        </button>
        <button
          onClick={clear}
          className="rounded-xl border border-zinc-700 px-4 py-2.5 text-sm text-zinc-400 active:bg-zinc-800"
        >
          Use Default
        </button>
      </div>
    </div>
  );
}

export function HeliusSetupPanel({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col h-full bg-zinc-950">
      <header className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 shrink-0">
        <button onClick={onBack} className="text-zinc-400 active:text-zinc-200 px-1 text-lg">←</button>
        <span className="font-medium text-sm">Helius API Key</span>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        <HeliusKeyForm onDone={onBack} />
      </div>
    </div>
  );
}
