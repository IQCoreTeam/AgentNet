import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { SkillSdCard } from "./SkillSdCard";
import { SkillDetailView } from "./SkillDetailView";
import { PublishForm } from "./PublishForm";
import { AgentDirectory } from "./AgentDirectory";
import { AgentProfileView } from "./AgentProfileView";
import type { SkillCard } from "../transport/protocol";
import { HeliusSetupPanel } from "../settings/HeliusKeyForm";
import { SkillDetailSkeleton, MarketListSkeleton, AgentProfileSkeleton } from "./Skeletons";

type MarketView = "browse" | "publish" | "helius";
export type ShellTab = "market" | "skills" | "profile";

// One "market machine" serving three of the four shell tabs (screen-rearrangement §9):
//   market  -> browse skills/workflows + publish (products only — agents live on their own tab)
//   skills  -> the owned collection (My Skills)
//   profile -> the AGENT tab: a people directory (your sticky self + others), tapping a card
//              pushes that agent's full profile. Browsing people is identity/SNS, not a row in
//              the product store, so the agents directory moved OUT of Market and lives here.
// Owned is no longer an internal tab (it is the Skills tab) and there is no back-to-chat
// button (the bottom tab bar owns navigation).
export function MarketScreen({ tab }: { tab: ShellTab }) {
  const { state, send, setMarketTab, setMarketQuery, marketSearching, clearMarketDetail, clearAgentProfile } = useStore();
  const [view, setView] = useState<MarketView>("browse");
  // Tracks a tapped card whose detail is still loading, so we can show a skeleton in the
  // gap between the tap and `marketDetail` arriving (there's no store-level loading flag).
  const [pendingMint, setPendingMint] = useState<string | null>(null);
  // Skills tab has no store-level loading flag, so show a skeleton briefly on entry (until
  // owned skills arrive or a short timeout) instead of flashing "No owned skills yet".
  const [ownedLoading, setOwnedLoading] = useState(tab === "skills");

  // Each tab drives the machine to its root + refreshes data. Clearing detail/profile
  // first stops one tab's open detail or self-profile leaking into another tab.
  useEffect(() => {
    setPendingMint(null);
    clearMarketDetail();
    clearAgentProfile();
    send({ type: "ownedSkills" });
    send({ type: "getRpcStatus" });
    send({ type: "getBalance" });
    // Agent tab: the directory fetches its own agent list; we do NOT auto-open the self
    // profile here (the directory's sticky "me" card / a chat-menu deep link opens it).
    if (tab === "market") {
      setView("browse");
      marketSearching();
      send({ type: "searchSkills", query: "", kind: state.marketTab });
    }
    // Clear the shared detail/profile when LEAVING this tab so the next tab's MarketScreen
    // mounts clean — otherwise its first frame shows the previous tab's open detail/profile
    // (the "stacked menu flashes the old screen" bug, same root as the chat off-by-one).
    return () => { clearMarketDetail(); clearAgentProfile(); setPendingMint(null); };
  }, [tab]);

  // Detail arrived (or was cleared) — drop the skeleton's pending state.
  useEffect(() => {
    if (state.marketDetail) setPendingMint(null);
  }, [state.marketDetail]);

  // Skills tab: skeleton on entry until the CHAIN-SOURCED owned data lands. We watch
  // marketOwnedCards (only the chain emit carries `cards`, even when empty → new ref), NOT
  // marketOwned: a names-only emit (chat panel / post-buy refresh) can arrive empty first
  // and would otherwise clear the skeleton early, flashing "No owned skills" before cards.
  const ownedAtArm = useRef(state.marketOwnedCards);
  useEffect(() => {
    if (tab !== "skills") return;
    ownedAtArm.current = state.marketOwnedCards;
    setOwnedLoading(true);
    const t = setTimeout(() => setOwnedLoading(false), 4000); // fallback if no response comes
    return () => clearTimeout(t);
  }, [tab]);
  useEffect(() => {
    if (state.marketOwnedCards !== ownedAtArm.current) setOwnedLoading(false);
  }, [state.marketOwnedCards]);

  function runSearch(q: string, t?: "skill" | "workflow") {
    marketSearching();
    send({ type: "searchSkills", query: q, kind: t ?? state.marketTab });
  }
  function handleTabChange(t: "skill" | "workflow") {
    setMarketTab(t);
    runSearch(state.marketQuery, t);
  }
  function handleOpenCard(card: SkillCard) {
    setPendingMint(card.id);
    send({ type: "getSkillDetail", mint: card.id });
  }

  // Skill detail (reachable from any tab)
  if (state.marketDetail) {
    return (
      <div className="flex flex-col h-full bg-zinc-950">
        <SkillDetailView
          detail={state.marketDetail}
          owned={state.marketOwned.includes(state.marketDetail.card.name)}
          onBack={() => { send({ type: "ownedSkills" }); clearMarketDetail(); }}
          onOpenSkill={(card) => send({ type: "getSkillDetail", mint: card.id })}
        />
      </div>
    );
  }

  // A skill was tapped and its detail is still loading — show the skeleton in the gap.
  if (pendingMint && !state.marketDetail) {
    return <SkillDetailSkeleton onBack={() => setPendingMint(null)} />;
  }

  // Tapped an agent card: show the profile skeleton the instant it's tapped, until the load lands
  // (or the user backs out). Mirrors the skill-detail pendingMint skeleton above.
  if (state.agentProfileLoading) {
    return (
      <div className="flex flex-col h-full bg-zinc-950">
        <AgentProfileSkeleton onBack={() => clearAgentProfile()} />
      </div>
    );
  }

  // Agent profile (self on Profile tab, or a tapped agent on Market tab)
  if (state.agentProfile) {
    return (
      <div className="flex flex-col h-full bg-zinc-950">
        <AgentProfileView
          profile={state.agentProfile}
          onBack={() => clearAgentProfile()}
          onOpenSkill={handleOpenCard}
        />
      </div>
    );
  }

  // Publish form (market tab)
  if (view === "publish") {
    return (
      <div className="flex flex-col h-full bg-zinc-950">
        <PublishForm onBack={() => setView("browse")} />
      </div>
    );
  }

  // Helius key setup (market tab)
  if (view === "helius") {
    return <HeliusSetupPanel onBack={() => setView("browse")} />;
  }

  const resultByName = new Map((state.marketResults ?? []).map((card) => [card.name, card]));
  // My Skills = the wallet's on-chain owned skill cards (read from holdings, like the agent
  // profile). Fall back to the name-derived placeholders only if the chain cards haven't
  // arrived yet, so the grid still shows something during the first fetch.
  const ownedCards: SkillCard[] = state.marketOwnedCards.length > 0
    ? state.marketOwnedCards
    : state.marketOwned.map((name) => {
        const found = resultByName.get(name);
        if (found) return found;
        return {
          id: state.marketOwnedMints[name] ?? name,
          name,
          description: "Owned skill",
        } as SkillCard;
      });

  const isSkills = tab === "skills";
  const isAgents = tab === "profile";
  const isMarket = tab === "market";
  const headerTitle = isSkills ? "My Skills" : isAgents ? "Agents" : "Market";
  const balanceSol = state.marketBalance != null ? (state.marketBalance / 1_000_000_000).toFixed(3) : null;

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header (no back-to-chat button — the bottom tab bar owns top-level nav) */}
      <header
        className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 shrink-0"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
      >
        <span className="font-semibold text-sm">{headerTitle}</span>
        {!isAgents && balanceSol && <span className="ml-auto text-xs text-zinc-500 font-mono">{balanceSol} SOL</span>}
        {isMarket && (
          <button
            onClick={() => setView("publish")}
            className={`${balanceSol ? "" : "ml-auto"} shrink-0 text-xs text-green-400 border border-green-700/50 rounded-lg px-2 py-1 active:bg-green-900/30`}
          >
            + Publish
          </button>
        )}
      </header>

      {/* RPC status nudge (market only) */}
      {isMarket && state.rpcStatus && !state.rpcStatus.hasKey && (
        <button
          onClick={() => setView("helius")}
          className="mx-3 mt-2 shrink-0 flex items-center gap-2 rounded-lg border border-amber-700/40 bg-amber-900/20 px-3 py-2 text-xs text-amber-400 active:bg-amber-900/40"
        >
          <span className="flex-1 text-left">Add Helius key for faster results</span>
          <span>›</span>
        </button>
      )}
      {isMarket && state.rpcStatus?.hasKey && (
        <div className="mx-3 mt-2 shrink-0 flex items-center gap-1.5 rounded-lg border border-green-800/40 bg-green-900/10 px-3 py-1.5 text-[11px] text-green-500">
          <span>●</span>
          <span>{state.rpcStatus.network} · {state.rpcStatus.masked}</span>
          <button onClick={() => setView("helius")} className="ml-auto text-zinc-600 hover:text-zinc-400">⚙</button>
        </div>
      )}

      {/* Browse tabs (market only): skill / workflow — agents moved to their own Agent tab */}
      {isMarket && (
        <div className="flex gap-0 border-b border-zinc-800 px-3 mt-2 shrink-0">
          {(["skill", "workflow"] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setView("browse"); handleTabChange(t); }}
              className={[
                "px-4 py-2 text-sm capitalize border-b-2 transition-colors",
                view === "browse" && state.marketTab === t
                  ? "border-green-500 text-green-400"
                  : "border-transparent text-zinc-500 active:text-zinc-300",
              ].join(" ")}
            >
              {t}s
            </button>
          ))}
        </div>
      )}

      {/* Search (market browse only) */}
      {isMarket && (
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
            <button type="submit" className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-300 active:bg-zinc-700">
              Search
            </button>
          </form>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 an-tabbar-inset">
        {isSkills ? (
          ownedLoading && state.marketOwned.length === 0 ? (
            <MarketListSkeleton />
          ) : state.marketOwned.length === 0 ? (
            <div className="py-8 text-center text-sm text-zinc-600">
              No owned skills yet. Browse the Market to get one.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3.5 pt-1">
              {ownedCards.map((card) => (
                <SkillSdCard
                  key={card.id}
                  card={card}
                  owned
                  disposed={Object.values(state.marketDisposed).includes(card.id)}
                  firing={state.firingSkills.some((f) => f.name === card.name)}
                  onOpen={handleOpenCard}
                />
              ))}
            </div>
          )
        ) : isAgents ? (
          <AgentDirectory />
        ) : (
          <>
            {state.marketSearchError ? (
              <div className="py-6 text-center text-sm text-red-400">{state.marketSearchError}</div>
            ) : state.marketSearching || state.marketResults == null ? (
              <MarketListSkeleton />
            ) : state.marketResults.length === 0 ? (
              <div className="py-8 text-center text-sm text-zinc-600">
                No {state.marketTab}s found.{!state.rpcStatus?.hasKey && " Add a Helius key for better results."}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3.5 pt-1">
                {state.marketResults.map((card) => (
                  <SkillSdCard
                    key={card.id}
                    card={card}
                    owned={state.marketOwned.includes(card.name)}
                    disposed={Object.values(state.marketDisposed).includes(card.id)}
                    firing={state.firingSkills.some((f) => f.name === card.name)}
                    onOpen={handleOpenCard}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
