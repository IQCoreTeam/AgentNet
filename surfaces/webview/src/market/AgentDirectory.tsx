import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useStore } from "../state/store";
import { haptics } from "../haptics";
import { walletAvatarSvg, walletBandColor } from "./walletAvatar";
import { AgentListSkeleton } from "./Skeletons";
import type { Reputation } from "../transport/protocol";
import { LockedGate } from "../unlock/UnlockProvider";

// The card's single accent — the avatar's own hue, normalized to one chic mid-tone so it reads
// the same as a tag fill / gauge fill whatever the avatar's exact shade. The colour avatar is the
// card's pop; THIS is the only UI colour, matched to it. Everything else stays mono grey, so a
// card never carries more than one accent.
function avatarAccent(wallet: string): string {
  const m = /hsl\((\d+)/.exec(walletBandColor(wallet));
  const hue = m ? Number(m[1]) : 210;
  return `hsl(${hue} 46% 62%)`;
}

// Tier shape — the bits a card actually reads from the ramp.
type Tier = { name: string; min: number; token: string };

// The ONE tier axis: verified-work stars. Copies are deliberately NOT a tier input — a free
// skill can rack up copies without earning reputation, so popularity must not buy a tier.
// Same --an-tier-* tokens + thresholds as the profile IQ gauge so an agent reads the same tier
// on the card and on their profile. Drives the tier tag + the STARS gauge denominator.
const STAR_TIERS = [
  { name: "Legendary", min: 250, token: "--an-tier-legendary" },
  { name: "Gold", min: 60, token: "--an-tier-gold" },
  { name: "Silver", min: 15, token: "--an-tier-silver" },
  { name: "Bronze", min: 3, token: "--an-tier-bronze" },
] as const;

function starTier(stars: number): Tier | null {
  return STAR_TIERS.find((t) => stars >= t.min) ?? null;
}

// The next tier's threshold above the current star count — the STARS gauge denominator. At the
// top tier already => cap at that threshold so the gauge simply reads full.
function nextTierMin(stars: number): number {
  const ascending = [...STAR_TIERS].sort((a, b) => a.min - b.min); // bronze..legendary
  const up = ascending.find((t) => t.min > stars);
  return up ? up.min : ascending[ascending.length - 1].min;
}

function shortWallet(wallet: string): string {
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

const SEG = 12; // STARS gauge segment count

// One full-width agent card, styled as a cyberpunk "business-card" trading card. STARS is the
// one segment gauge (filled toward the next tier); CREATED/COPIES are plain mono stats; the net
// EARNED (price x sales minus the protocol fee, summed by the server) sits in the footer. The
// tier tag carries the same --an-tier-* colour the agent reads everywhere else.
function AgentCard({ agent, self, onOpen }: { agent: Reputation; self?: boolean; onOpen: (w: string) => void }) {
  const avatar = useMemo(() => walletAvatarSvg(agent.wallet), [agent.wallet]);
  const stars = agent.stars ?? 0;
  const tier = starTier(stars);
  const isMax = tier?.name === "Legendary";
  const denom = nextTierMin(stars);
  const filled = Math.max(0, Math.min(SEG, Math.round((stars / denom) * SEG)));
  const tierName = (tier?.name ?? "Unranked").toUpperCase();

  const created = agent.skillsPublished ?? 0;
  const copies = agent.totalSupply ?? 0;
  const earnedSol = agent.totalEarned ? Number(agent.totalEarned) / 1e9 : 0;
  const earned = earnedSol >= 100 ? earnedSol.toFixed(0) : earnedSol.toFixed(2);
  const sig = 34 + (agent.wallet.charCodeAt(2) % 6) * 11; // decorative battery fill
  const accent = avatarAccent(agent.wallet);

  return (
    <button
      onClick={() => { haptics.tick(); onOpen(agent.wallet); }}
      className={`an-ac ${self ? "is-self" : ""}`}
      style={{ "--accent": accent } as CSSProperties}
    >
      <div className="an-ac-in">
        <div className="an-ac-top">
          <span className="an-ac-hand">{`>${shortWallet(agent.wallet).toUpperCase()}_AGENT`}{self && <span className="an-ac-you"> // YOU</span>}</span>
          <span className="an-ac-sig">SIGNAL <span className="an-ac-batt"><i style={{ width: `${sig}%` }} /></span></span>
        </div>
        <div className="an-ac-namerow">
          <div>
            <div className="an-ac-kana">エージェント</div>
            <div className="an-ac-name">{agent.wallet.slice(0, 6).toUpperCase()}</div>
          </div>
          <div className="an-ac-access">
            アクセス / ACCESS
            <br />
            <span className={`an-ac-tier ${tier ? "" : "unranked"}`}>{tierName}</span>
          </div>
        </div>
        <div className="an-ac-body">
          <div className="an-ac-ava" aria-hidden="true" dangerouslySetInnerHTML={{ __html: avatar }} />
          <div className="an-ac-attr">
            <div>
              <div className="an-ac-rank">&mdash; RANKING &mdash;</div>
              <div className="an-ac-gauge">
                <span className="lab">STARS</span>
                <span className="an-ac-segs">
                  {Array.from({ length: SEG }, (_, i) => (
                    <i key={i} className={i < filled ? "on" : ""} />
                  ))}
                </span>
                <span className="val">{isMax ? `${stars}` : `${stars}/${denom}`}</span>
              </div>
            </div>
            <div className="an-ac-stats">
              <div className="an-ac-stat"><div className="k">CREATED</div><div className="v">{created}</div></div>
              <div className="an-ac-stat"><div className="k">COPIES</div><div className="v">{copies}</div></div>
            </div>
          </div>
        </div>
        <div className="an-ac-foot">
          <span className="an-ac-box" />
          <span>&gt;EARNED <span className="earn">{earned}&#9678;</span></span>
          <span className="an-ac-box" />
        </div>
      </div>
    </button>
  );
}

// The Agent tab root: your own agent pinned at the top (sticky, tap to open your full page),
// then every other agent ranked by Copies. Tapping any card pushes that agent's full profile
// (MarketScreen owns the agentProfile -> AgentProfileView swap). Browsing people lives here,
// NOT inside the Market tab — an agent is an identity/storefront, not a row in a product list.
export function AgentDirectory() {
  const { state, send, loadingAgents } = useStore();
  // Show the skeleton until the first load finishes, so the empty "No agents found" can't
  // flash on the first frame (before loadingAgents() flips the flag in the effect below).
  const [everLoaded, setEverLoaded] = useState(false);
  const wasLoading = useRef(false);

  useEffect(() => {
    loadingAgents();
    send({ type: "listAgents" });
  }, []);

  useEffect(() => {
    if (state.agentsLoading) wasLoading.current = true;
    else if (wasLoading.current) setEverLoaded(true);
  }, [state.agentsLoading]);

  function openProfile(wallet: string) {
    send({ type: "getAgentProfile", wallet });
  }

  const selfWallet = state.walletAddress;
  // Pull the connected wallet's own stats from the leaderboard when it ranks; otherwise pin a
  // zero-stat self card so "me" is always present and tappable (the full page fills it in).
  const selfRep: Reputation | null = useMemo(() => {
    if (!selfWallet) return null;
    return (
      state.agents.find((a) => a.wallet === selfWallet) ?? {
        wallet: selfWallet,
        skillsPublished: 0,
        totalSupply: 0,
        notesReceived: 0,
        updatedAt: 0,
      }
    );
  }, [state.agents, selfWallet]);
  // Wallet search: filter the ranked list to agents whose address contains the query (case-
  // insensitive). The self card stays pinned regardless so "me" is always reachable.
  const [query, setQuery] = useState("");
  const others = useMemo(() => {
    const base = state.agents.filter((a) => a.wallet !== selfWallet);
    const q = query.trim().toLowerCase();
    return q ? base.filter((a) => a.wallet.toLowerCase().includes(q)) : base;
  }, [state.agents, selfWallet, query]);

  // Loading = first fetch hasn't landed yet. An EMPTY leaderboard counts as "still coming" too —
  // a slow/failed startup fetch returns [] (everLoaded flips true), and without this the screen
  // flashes my self card with zero stats + "No other agents". The legit "only me" case keeps a
  // card (agents = [self], others = []), so this only skeletons a truly empty board. Self renders
  // as a skeleton too, so my own stats never flash zeros before the leaderboard lands.
  const loading = state.agentsLoading || !everLoaded || state.agents.length === 0;

  return (
    <div className="pt-1">
      {/* Sticky "me" + wallet search: both pinned so the self card and the filter stay reachable
          while the ranked list scrolls under them. */}
      <div className="sticky top-0 z-10 pt-1" style={{ background: "var(--an-bg-0)" }}>
        <div className="pb-2.5">
          {loading ? (
            <AgentListSkeleton rows={1} />
          ) : !selfRep ? (
            <LockedGate reason="identity" onUnlocked={() => send({ type: "listAgents" })} className="mx-3 block">
              <button className="an-bracket flex w-full items-center justify-between px-4 py-4 text-left" style={{ "--tk": "var(--an-green)", "--bk": "var(--an-bg-1)", "--ts": "8px" } as CSSProperties}>
                <span>
                  <span className="an-term-mono block text-xs font-bold uppercase" style={{ color: "var(--an-fg)" }}>Claim your agent identity</span>
                  <span className="mt-1 block text-[11px]" style={{ color: "var(--an-fg-mute)" }}>Connect a wallet to join the rank</span>
                </span>
                <span className="an-term-mono" style={{ color: "var(--an-green)" }}>UNLOCK</span>
              </button>
            </LockedGate>
          ) : (
            <AgentCard agent={selfRep} self onOpen={openProfile} />
          )}
        </div>
        {/* wallet search — filters the ranked list below */}
        <div className="mb-2.5 flex items-center gap-2.5 px-3" style={{ height: "38px", background: "#0b0b0c", border: "1px solid #2a2a2e" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7a7a7a" strokeWidth="1.8" className="shrink-0"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.5-4.5" /></svg>
        <input
          className="an-term-mono min-w-0 flex-1 bg-transparent text-[11px] uppercase tracking-wide placeholder:uppercase placeholder:tracking-wide focus:outline-none"
          style={{ color: "#e8e8e8" }}
          placeholder="Search agent wallet…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        {query && (
          <button onClick={() => setQuery("")} aria-label="Clear search" className="shrink-0 active:opacity-70" style={{ color: "#7a7a7a" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        )}
        </div>
      </div>

      {loading ? (
        <AgentListSkeleton rows={4} />
      ) : others.length === 0 ? (
        <div className="an-term-mono py-10 text-center text-[11px] uppercase tracking-wider" style={{ color: "#5a5a5d" }}>
          {query.trim() ? "No agent matches that wallet" : "No other agents yet"}
        </div>
      ) : (
        <div className="space-y-2.5">
          {others.map((agent) => (
            <AgentCard key={agent.wallet} agent={agent} onOpen={openProfile} />
          ))}
        </div>
      )}
    </div>
  );
}
