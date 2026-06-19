import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { SkillCardTile } from "./SkillCardTile";
import { SkillDetailView } from "./SkillDetailView";
import { PublishForm } from "./PublishForm";
import { AgentDirectory } from "./AgentDirectory";
import { AgentProfileView } from "./AgentProfileView";
import { BuyCelebration } from "./BuyCelebration";
import type { SkillCard } from "../transport/protocol";

type MarketView = "browse" | "publish" | "helius" | "agents";

export function MarketScreen() {
  const { state, send, closeMarket, setMarketTab, setMarketQuery, marketSearching, clearMarketDetail, clearAgentProfile } = useStore();
  const [view, setView] = useState<MarketView>("browse");

  // On first open: load owned skills, RPC status, and initial search
  useEffect(() => {
    send({ type: "ownedSkills" });
    send({ type: "getRpcStatus" });
    send({ type: "getBalance" });
    send({ type: "searchSkills", query: "", kind: state.marketTab });
  }, []);

  // When agent profile loads, switch to agents view to show it
  useEffect(() => {
    if (state.agentProfile) setView("agents");
  }, [state.agentProfile]);

  function runSearch(q: string, tab?: "skill" | "workflow") {
    marketSearching();
    send({ type: "searchSkills", query: q, kind: tab ?? state.marketTab });
  }

  function handleTabChange(tab: "skill" | "workflow") {
    setMarketTab(tab);
    runSearch(state.marketQuery, tab);
  }

  function handleOpenCard(card: SkillCard) {
    send({ type: "getSkillDetail", mint: card.id });
  }

  // Detail view
  if (state.marketDetail) {
    return (
      <div className="flex flex-col h-full bg-zinc-950">
        <SkillDetailView
          detail={state.marketDetail}
          owned={state.marketOwned.includes(state.marketDetail.card.name)}
          onBack={() => { send({ type: "ownedSkills" }); clearMarketDetail(); }}
          onOpenSkill={(card) => send({ type: "getSkillDetail", mint: card.id })}
        />
        {state.buyCelebrate && <BuyCelebration />}
      </div>
    );
  }

  // Publish form
  if (view === "publish") {
    return (
      <div className="flex flex-col h-full bg-zinc-950">
        <PublishForm onBack={() => setView("browse")} />
      </div>
    );
  }

  // Agent profile
  if (view === "agents" && state.agentProfile) {
    return (
      <div className="flex flex-col h-full bg-zinc-950">
        <AgentProfileView
          profile={state.agentProfile}
          onBack={() => clearAgentProfile()}
          onOpenSkill={(card) => send({ type: "getSkillDetail", mint: card.id })}
        />
      </div>
    );
  }

  // Helius key setup
  if (view === "helius") {
    return <HeliusSetup onBack={() => setView("browse")} />;
  }

  const balanceSol = state.marketBalance != null ? (state.marketBalance / 1_000_000_000).toFixed(3) : null;

  return (
    <div className="flex flex-col h-full bg-zinc-950" style={{ height: "var(--vvh, 100dvh)" }}>
      {/* Header */}
      <header
        className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 shrink-0"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
      >
        <button onClick={closeMarket} className="shrink-0 text-zinc-400 active:text-zinc-200 px-1 text-lg">←</button>
        <span className="font-semibold text-sm">Markets</span>
        {balanceSol && (
          <span className="ml-auto text-xs text-zinc-500 font-mono">{balanceSol} SOL</span>
        )}
        <button
          onClick={() => setView("publish")}
          className="shrink-0 text-xs text-green-400 border border-green-700/50 rounded-lg px-2 py-1 active:bg-green-900/30"
        >
          + Publish
        </button>
      </header>

      {/* RPC status nudge */}
      {state.rpcStatus && !state.rpcStatus.hasKey && (
        <button
          onClick={() => setView("helius")}
          className="mx-3 mt-2 shrink-0 flex items-center gap-2 rounded-lg border border-amber-700/40 bg-amber-900/20 px-3 py-2 text-xs text-amber-400 active:bg-amber-900/40"
        >
          <span className="flex-1 text-left">Add Helius key for faster results</span>
          <span>›</span>
        </button>
      )}
      {state.rpcStatus?.hasKey && (
        <div className="mx-3 mt-2 shrink-0 flex items-center gap-1.5 rounded-lg border border-green-800/40 bg-green-900/10 px-3 py-1.5 text-[11px] text-green-500">
          <span>●</span>
          <span>{state.rpcStatus.network} · {state.rpcStatus.masked}</span>
          <button onClick={() => setView("helius")} className="ml-auto text-zinc-600 hover:text-zinc-400">⚙</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-0 border-b border-zinc-800 px-3 mt-2 shrink-0">
        {(["skill", "workflow"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => { setView("browse"); handleTabChange(tab); }}
            className={[
              "px-4 py-2 text-sm capitalize border-b-2 transition-colors",
              view === "browse" && state.marketTab === tab
                ? "border-green-500 text-green-400"
                : "border-transparent text-zinc-500 active:text-zinc-300",
            ].join(" ")}
          >
            {tab}s
          </button>
        ))}
        <button
          onClick={() => setView("agents")}
          className={[
            "px-4 py-2 text-sm border-b-2 transition-colors",
            view === "agents"
              ? "border-green-500 text-green-400"
              : "border-transparent text-zinc-500 active:text-zinc-300",
          ].join(" ")}
        >
          Agents
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 shrink-0">
        <form
          onSubmit={(e) => { e.preventDefault(); runSearch(state.marketQuery); }}
          className="flex gap-2"
        >
          <input
            className="flex-1 rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-green-500/50"
            placeholder={`Search ${state.marketTab}s…`}
            value={state.marketQuery}
            onChange={(e) => setMarketQuery(e.target.value)}
          />
          <button
            type="submit"
            className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-300 active:bg-zinc-700"
          >
            Search
          </button>
        </form>
      </div>

      {/* Results / Agent directory */}
      <div className="flex-1 overflow-y-auto px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {view === "agents" ? (
          <AgentDirectory />
        ) : (
          <>
            {state.marketSearching && (
              <div className="py-8 text-center text-sm text-zinc-600">Searching…</div>
            )}
            {state.marketSearchError && (
              <div className="py-6 text-center text-sm text-red-400">{state.marketSearchError}</div>
            )}
            {!state.marketSearching && state.marketResults?.length === 0 && (
              <div className="py-8 text-center text-sm text-zinc-600">
                No {state.marketTab}s found.{!state.rpcStatus?.hasKey && " Add a Helius key for better results."}
              </div>
            )}
            <div className="space-y-2 pt-1">
              {state.marketResults?.map((card) => (
                <SkillCardTile
                  key={card.id}
                  card={card}
                  owned={state.marketOwned.includes(card.name)}
                  firing={state.firingSkill === card.name}
                  onOpen={handleOpenCard}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function HeliusSetup({ onBack }: { onBack: () => void }) {
  const { send } = useStore();
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);

  function save() {
    if (!key.trim()) return;
    setSaving(true);
    send({ type: "submitHeliusKey", key: key.trim() });
    setTimeout(onBack, 1200);
  }

  function clear() {
    send({ type: "useDefaultRpc" });
    onBack();
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      <header className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 shrink-0">
        <button onClick={onBack} className="text-zinc-400 active:text-zinc-200 px-1 text-lg">←</button>
        <span className="font-medium text-sm">Helius API Key</span>
      </header>
      <div className="flex-1 p-4 space-y-4">
        <p className="text-sm text-zinc-400">
          A Helius key enables fast NFT indexing and skill search. Stored locally, never synced.
        </p>
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
    </div>
  );
}
