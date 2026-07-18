import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useStore } from "../state/store";
import { SkillSdCard } from "./SkillSdCard";
import { SkillDetailView } from "./SkillDetailView";
import { PublishForm } from "./PublishForm";
import { AgentDirectory } from "./AgentDirectory";
import { AgentProfileView } from "./AgentProfileView";
import type { SkillCard } from "../transport/protocol";
import { HeliusSetupPanel } from "../settings/HeliusKeyForm";
import { SkillDetailSkeleton, MarketListSkeleton, AgentProfileSkeleton } from "./Skeletons";
import { LockedGate, useUnlock } from "../unlock/UnlockProvider";
import { LockIcon } from "../icons";
import { AlertCard } from "../Alert";
import { haptics } from "../haptics";

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
export function MarketScreen({ tab, onBack, onGoMarket }: { tab: ShellTab; onBack?: () => void; onGoMarket?: () => void }) {
  const { state, send, setMarketTab, marketSearching, clearMarketDetail, clearAgentProfile } = useStore();
  const { unlocked, requestUnlock } = useUnlock();
  // Search text is LOCAL: keying it into the global store re-rendered the whole app on every
  // keystroke. Only MarketScreen reads it, so it lives here (matches AgentDirectory's search).
  const [query, setQuery] = useState("");
  const [view, setView] = useState<MarketView>("browse");
  // Hide already-owned skills from the market results by default (you came to find NEW ones);
  // untick to show them too (muted/greyed).
  const [hideOwned, setHideOwned] = useState(true);
  // Market ranking: popularity (supply, indexer default) or GitHub stars (issue #89).
  const [marketSort, setMarketSort] = useState<"supply" | "stars">("supply");
  // Tracks a tapped card whose detail is still loading, so we can show a skeleton in the
  // gap between the tap and `marketDetail` arriving (there's no store-level loading flag).
  const [pendingMint, setPendingMint] = useState<string | null>(null);
  // Skills tab has no store-level loading flag, so show a skeleton briefly on entry (until
  // owned skills arrive or a short timeout) instead of flashing "No owned skills yet".
  const [ownedLoading, setOwnedLoading] = useState(tab === "skills");
  // Helius retry prompt: when a market search FAILS (rate-limit / timeout / RPC error) — NOT
  // when it merely returns empty — the keyless indexer path couldn't serve the catalog, which
  // a Helius key can fix. Surface an actionable alert that buzzes on appear and shortcuts to the
  // SAME Helius setup the tutorial uses. Fires on each fresh failure (the null->error edge), so
  // a re-search that fails again re-buzzes but a plain re-render doesn't.
  const [showHeliusPrompt, setShowHeliusPrompt] = useState(false);
  const prevSearchErr = useRef<string | null>(null);
  useEffect(() => {
    const err = state.marketSearchError;
    if (err && prevSearchErr.current == null) {
      setShowHeliusPrompt(true);
      haptics.error(); // failure buzz as the popup appears
    }
    prevSearchErr.current = err;
  }, [state.marketSearchError]);

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
      send({ type: "searchSkills", query: "", kind: state.marketTab, sort: marketSort });
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

  function runSearch(q: string, t?: "skill" | "workflow", sort?: "supply" | "stars") {
    marketSearching();
    send({ type: "searchSkills", query: q, kind: t ?? state.marketTab, sort: sort ?? marketSort });
  }
  function handleTabChange(t: "skill" | "workflow") {
    setMarketTab(t);
    runSearch(query, t);
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

  // Publish form (market tab) — opens pre-set to whichever kind you were browsing (skill
  // or workflow tab), same as the VSCode builder.
  if (view === "publish") {
    return (
      <div className="flex flex-col h-full bg-zinc-950">
        <PublishForm initialKind={state.marketTab} onBack={() => setView("browse")} />
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
  const headerTitle = isSkills ? "My Skills" : isAgents ? "Agent Rank" : "Market";
  const headerSub = isSkills ? "マイスキル" : isAgents ? "エージェント" : "マーケット";
  const balanceSol = state.marketBalance != null ? (state.marketBalance / 1_000_000_000).toFixed(3) : null;

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header (no back-to-chat button — the bottom tab bar owns top-level nav) */}
      <header
        className="flex items-start gap-2.5 border-b px-3.5 shrink-0"
        style={{ borderColor: "#1d1d20", paddingTop: "max(0.5rem, env(safe-area-inset-top))", paddingBottom: "0.7rem" }}
      >
        {onBack && (
          <button onClick={onBack} className="an-iconbtn shrink-0" aria-label="Back to settings">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="an-term-title text-[18px] leading-none">{headerTitle}</div>
          <div className="an-term-sub leading-none">{headerSub}</div>
        </div>
        {/* SKILLS: SOL balance + owned-count readout (stacked, right-aligned) */}
        {isSkills && (
          <div className="shrink-0 text-right">
            {balanceSol && <div className="an-term-mono text-[13px] font-bold leading-none" style={{ color: "#bdbdbd", letterSpacing: "0.5px" }}>{balanceSol} ◎</div>}
            <div className="an-term-mono text-[8px] font-bold tracking-wider" style={{ color: "#5a5a5d", marginTop: "5px" }}>[ {state.marketOwned.length} OWNED ]</div>
          </div>
        )}
        {/* MARKET: SOL balance + publish */}
        {isMarket && balanceSol && <span className="an-term-mono shrink-0 text-xs font-bold" style={{ color: "#bdbdbd", letterSpacing: "0.5px" }}>{balanceSol} ◎</span>}
        {isMarket && (
          <LockedGate reason="publish" onUnlocked={() => setView("publish")} className="shrink-0" badge={false}>
            <button
              onClick={() => setView("publish")}
              className="an-term-mono text-[10px] font-bold uppercase tracking-wider active:opacity-80"
              style={{ color: "#4ade80", border: "1px solid #1d3a26", background: "#0d140f", padding: "7px 11px" }}
            >
              + Publish
            </button>
          </LockedGate>
        )}
      </header>

      {/* Skills tab: a green terminal title bar that shows the lock state at a glance. */}
      {isSkills && (
        <div
          className="mx-3 mt-2 flex shrink-0 items-center justify-between"
          style={{
            backgroundColor: "var(--an-green)",
            backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.09) 0, rgba(0,0,0,0.09) 1px, transparent 1px, transparent 4px)",
            color: "var(--an-on-green)",
            padding: "8px 12px",
          }}
        >
          <span className="an-term-mono text-[13px] font-bold uppercase tracking-[0.16em]">Skills</span>
          <span className="an-term-mono flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em]">
            {unlocked ? "● Online" : <><LockIcon className="h-3.5 w-3.5" /> Locked</>}
          </span>
        </div>
      )}

      {/* RPC status nudge (market only) */}
      {isMarket && state.rpcStatus && !state.rpcStatus.hasKey && (
        <button
          onClick={() => setView("helius")}
          className="an-bracket mx-3.5 mt-2.5 shrink-0 flex items-center gap-2.5 px-3 py-2.5 active:opacity-80"
          style={{ border: "1px solid #5a4420", color: "#e0913e", "--ts": "8px", "--bk": "#140d04", "--tk": "#c9772f" } as CSSProperties}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 3 L22 20 H2 Z" /><path d="M12 10 V14" /><circle cx="12" cy="17" r=".7" fill="currentColor" stroke="none" /></svg>
          <span className="an-term-mono flex-1 text-left text-[10px] font-bold uppercase tracking-wide">Add Helius key for faster results</span>
          <span className="an-term-mono font-bold">›</span>
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
        <div className="flex items-end gap-6 border-b px-3.5 mt-3 shrink-0" style={{ borderColor: "#1d1d20" }}>
          {(["skill", "workflow"] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setView("browse"); handleTabChange(t); }}
              className={[
                "an-term-mono -mb-px px-1 pb-2.5 pt-2 text-[11px] font-bold uppercase tracking-wider border-b-2 transition-colors",
                view === "browse" && state.marketTab === t
                  ? "border-green-500 text-green-400"
                  : "border-transparent text-zinc-500 active:text-zinc-300",
              ].join(" ")}
            >
              {t}s
            </button>
          ))}
          {/* HIDE OWNED filter — on by default so the grid surfaces NEW skills */}
          <button onClick={() => setHideOwned((v) => !v)} className="ml-auto flex items-center gap-2 pb-2.5 active:opacity-80">
            <span
              className="flex h-[16px] w-[16px] shrink-0 items-center justify-center"
              style={{ border: hideOwned ? "1px solid #2f6b46" : "1px solid #3a3a3d", background: hideOwned ? "#0d160f" : "#0c0c0d" }}
            >
              {hideOwned && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
            </span>
            <span className="an-term-mono text-[9px] font-bold uppercase tracking-wider" style={{ color: hideOwned ? "#9a9a9a" : "#6a6a6a" }}>Hide owned</span>
          </button>
          {/* SORT toggle — popularity (supply) vs GitHub stars (issue #89) */}
          <button
            onClick={() => { const next = marketSort === "stars" ? "supply" : "stars"; setMarketSort(next); runSearch(query, undefined, next); }}
            className="ml-3 an-term-mono text-[9px] font-bold uppercase tracking-wider pb-2.5 active:opacity-80"
            style={{ color: marketSort === "stars" ? "#e0a23a" : "#6a6a6a" }}
          >
            {marketSort === "stars" ? "★ Stars" : "Popular"}
          </button>
        </div>
      )}

      {/* Search (market browse only) */}
      {isMarket && (
        <div className="px-3.5 py-3 shrink-0">
          <form
            onSubmit={(e) => { e.preventDefault(); runSearch(query); }}
            className="flex gap-2"
          >
            <div className="flex flex-1 items-center gap-2.5 px-3" style={{ height: "40px", background: "#0b0b0c", border: "1px solid #2a2a2e" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7a7a7a" strokeWidth="1.8" className="shrink-0"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.5-4.5" /></svg>
              <input
                className="an-term-mono min-w-0 flex-1 bg-transparent text-[11px] uppercase tracking-wide text-zinc-200 placeholder:uppercase placeholder:tracking-wide focus:outline-none"
                style={{ color: "#e8e8e8" }}
                placeholder={`Search ${state.marketTab}s…`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <button type="submit" className="an-term-mono text-[10px] font-bold uppercase tracking-widest active:opacity-80" style={{ padding: "0 18px", height: "40px", border: "1px solid #34343a", background: "#141416", color: "#e8e8e8" }}>
              Search
            </button>
          </form>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 an-tabbar-inset">
        {isSkills ? (
          !unlocked ? (
            <SkillsLocked onUnlock={() => requestUnlock("skills")} />
          ) : ownedLoading && state.marketOwned.length === 0 ? (
            <MarketListSkeleton />
          ) : state.marketOwned.length === 0 ? (
            /* unlock-flow-v2 "Empty state · No owned skills": dashed slot grid + basket glyph */
            <div className="flex min-h-[420px] items-center justify-center">
              <div className="flex max-w-[260px] flex-col items-center text-center">
                <div className="relative grid grid-cols-3 gap-1.5" aria-hidden="true">
                  {Array.from({ length: 6 }, (_, i) => (
                    <span key={i} className="h-16 w-16" style={{ border: "1px dashed rgba(255,255,255,0.16)", background: "rgba(255,255,255,0.02)" }} />
                  ))}
                  <div className="absolute inset-0 flex items-center justify-center" style={{ color: "var(--an-fg-mute)" }}>
                    <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square"><path d="M5 9h14l-1.5 11h-11z" /><path d="M9 9V7a3 3 0 0 1 6 0v2" /></svg>
                  </div>
                </div>
                <p className="an-term-mono mt-4 text-[12px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--an-fg-dim)" }}>Inventory_Empty</p>
                <p className="an-term-mono mt-2 text-[11px] leading-relaxed" style={{ color: "var(--an-fg-mute)" }}>
                  No owned skills yet. Slots are waiting. Grab your first one from the market.
                </p>
                <button
                  onClick={() => { haptics.tap(); setMarketTab("skill"); onGoMarket?.(); }}
                  className="an-term-mono mt-4 px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] active:opacity-80"
                  style={{ border: "1px solid var(--an-line)", color: "var(--an-fg-dim)", background: "transparent" }}
                >
                  &gt; Browse_Market
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3.5 pt-3">
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
                {state.marketResults
                  .filter((card) => !hideOwned || !state.marketOwned.includes(card.name))
                  .map((card) => {
                  const isOwned = state.marketOwned.includes(card.name);
                  return (
                    <SkillSdCard
                      key={card.id}
                      card={card}
                      owned={isOwned}
                      dim={isOwned}
                      disposed={Object.values(state.marketDisposed).includes(card.id)}
                      firing={state.firingSkills.some((f) => f.name === card.name)}
                      onOpen={handleOpenCard}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Helius retry prompt — alert-style plaque that buzzes in on a failed market load and
          shortcuts to the same key setup the tutorial uses. Only on the market tab's browse
          view (that's the only place a search runs / errors). */}
      {isMarket && view === "browse" && showHeliusPrompt && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center px-6">
          <div className="pointer-events-auto w-full max-w-[300px]">
            <AlertCard
              kind="ERROR"
              className="an-alert-enter"
              message={
                state.rpcStatus?.hasKey
                  ? "Market load failed — your Helius key may be rate-limited or down. Update it and retry?"
                  : "Market load failed (rate-limited or timed out). Add your own Helius key for reliable results, then retry?"
              }
              onClose={() => setShowHeliusPrompt(false)}
              actions={[
                {
                  label: state.rpcStatus?.hasKey ? "UPDATE KEY" : "ADD HELIUS KEY",
                  onClick: () => { setShowHeliusPrompt(false); setView("helius"); },
                  variant: "solid",
                },
                { label: "DISMISS", onClick: () => setShowHeliusPrompt(false), variant: "ghost" },
              ]}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Mockup skills shown (dimmed) behind the locked panel — a teaser of what unlocking opens,
// so the empty pre-wallet Skills tab still reads as "there's a market here".
const MOCK_SKILLS = [
  { id: "mock-1", name: "PRICE FEED", price: "100000000", category: "data" },
  { id: "mock-2", name: "TOKEN SCREENER", price: "250000000", category: "data" },
  { id: "mock-3", name: "TX SUMMARIZER", price: "150000000", category: "text" },
  { id: "mock-4", name: "WALLET WATCHER", price: "200000000", category: "data" },
  { id: "mock-5", name: "AIRDROP SCOUT", price: "120000000", category: "defi" },
  { id: "mock-6", name: "NFT MINTER", price: "300000000", category: "nft" },
] as SkillCard[];

// The Skills tab before a wallet is connected: mockup skill chips sit dimmed behind an
// "Access Denied" terminal panel, so the value is visible but gated. Tapping Unlock routes
// into the shared unlock flow (same as every other LockedGate).
function SkillsLocked({ onUnlock }: { onUnlock: () => void }) {
  return (
    <div className="relative min-h-full pt-3">
      <div className="pointer-events-none grid grid-cols-3 gap-3.5 opacity-25" style={{ filter: "saturate(0.35)" }} aria-hidden="true">
        {MOCK_SKILLS.map((card) => (
          <SkillSdCard key={card.id} card={card} owned={false} onOpen={() => undefined} />
        ))}
      </div>
      <div className="absolute inset-0 flex items-center justify-center p-5">
        <div
          className="an-bracket unlock-denied-in w-full max-w-[290px] p-4 pb-5"
          style={{ border: "1px solid #1d3a26", "--ts": "12px", "--bk": "var(--an-bg-0)", "--tk": "#2f6b46" } as CSSProperties}
        >
          {/* terminal auth-check meta line */}
          <div className="an-term-mono flex items-center justify-between pb-3 text-[9px] uppercase tracking-[0.14em]" style={{ color: "var(--an-fg-mute)" }}>
            <span>&gt;AUTH_CHECK</span><span>アクセス拒否</span>
          </div>
          <span className="mx-auto mb-3 grid h-14 w-14 place-items-center" style={{ border: "1px solid #1d3a26", background: "var(--an-green-dim)", color: "var(--an-green)" }}>
            <LockIcon className="h-7 w-7" />
          </span>
          {/* green scanline banner — the "Access Denied" bar (matches the Skills title bar) */}
          <div
            className="an-term-mono text-center text-[15px] font-extrabold uppercase tracking-[0.2em]"
            style={{
              backgroundColor: "var(--an-green)",
              backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.11) 0, rgba(0,0,0,0.11) 1px, transparent 1px, transparent 4px)",
              color: "var(--an-on-green)",
              padding: "9px 10px",
            }}
          >
            Access Denied
          </div>
          <p className="an-term-mono mx-auto mt-3 max-w-[240px] text-center text-[10px] uppercase leading-relaxed tracking-wide" style={{ color: "var(--an-fg-dim)" }}>
            6 skills detected. Connect a wallet to browse, collect, and publish.
          </p>
          <button onClick={onUnlock} className="an-btn an-btn-green mt-4 w-full">Unlock Agent</button>
        </div>
      </div>
    </div>
  );
}
