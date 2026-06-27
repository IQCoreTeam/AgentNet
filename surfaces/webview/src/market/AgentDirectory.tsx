import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useStore } from "../state/store";
import { walletAvatarSvg, walletBandColor } from "./walletAvatar";
import { AgentListSkeleton } from "./Skeletons";
import type { Reputation } from "../transport/protocol";

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
      onClick={() => onOpen(agent.wallet)}
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
  const others = useMemo(
    () => state.agents.filter((a) => a.wallet !== selfWallet),
    [state.agents, selfWallet],
  );

  if (state.agentsLoading || !everLoaded) {
    return <AgentListSkeleton />;
  }

  return (
    <div className="pt-1">
      {/* Sticky "me": always reachable, opens your own full page (same as a chat-menu My Agent). */}
      {selfRep && (
        <div className="sticky top-0 z-10 pb-3 pt-1" style={{ background: "var(--an-bg-0)" }}>
          <AgentCard agent={selfRep} self onOpen={openProfile} />
        </div>
      )}

      <div className="mb-2 flex items-center justify-between px-0.5">
        <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--an-fg-mute)" }}>Agents</span>
        <span className="text-[11px]" style={{ color: "var(--an-fg-mute)" }}>by copies</span>
      </div>

      {others.length === 0 ? (
        <div className="py-10 text-center text-sm" style={{ color: "var(--an-fg-mute)" }}>No other agents yet.</div>
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
