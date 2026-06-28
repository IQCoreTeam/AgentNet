import { useRef } from "react";
import { useElementHeightVariable } from "../layoutEffects";
import { useStore } from "../state/store";

// The four top-level domains as an ordered pager (screen-rearrangement.md §9):
// Chat · Skills · Agent · Market. Agent = "My Agent".
export type TabKey = "chat" | "skills" | "profile" | "market";

export const TAB_ORDER: TabKey[] = ["chat", "skills", "profile", "market"];

// VAR_01 "mono invert" glyphs (16x16, stroke 1.8), matched to the Nav Dock design.
function ChatGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="5" width="16" height="11" rx="1" />
      <path d="M8 16 L8 20 L13 16" />
    </svg>
  );
}
function SkillsGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" />
    </svg>
  );
}
function AgentGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="5" y="8" width="14" height="11" rx="1" />
      <path d="M12 4 L12 8" />
      <circle cx="12" cy="3.4" r="1.1" fill="currentColor" stroke="none" />
      <rect x="8.5" y="12" width="2.2" height="2.6" fill="currentColor" stroke="none" />
      <rect x="13.3" y="12" width="2.2" height="2.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
function MarketGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="5" y="7" width="14" height="12" />
      <path d="M5 11 H19" />
      <path d="M12 11 V19" />
    </svg>
  );
}

const TABS: { key: TabKey; label: string; Glyph: () => JSX.Element }[] = [
  { key: "chat", label: "CHAT", Glyph: ChatGlyph },
  { key: "skills", label: "SKILLS", Glyph: SkillsGlyph },
  { key: "profile", label: "AGENT", Glyph: AgentGlyph },
  { key: "market", label: "MARKET", Glyph: MarketGlyph },
];

// Compact centered "NAV_DOCK" (Nav Dock design, VAR_01 · mono invert): a 296px terminal bar with
// corner-tick brackets and four equal segments. The active segment is filled by a sliding
// indicator tinted to the live ENGINE (Claude = orange, Codex = green) with dark icon/label + a
// blinking dot; the rest read grey on near-black. The indicator tracks `position` (fractional, so
// it follows a live page swipe) and animates on tap (transition off only while dragging).
export function TabBar({ position, instant, onChange }: { position: number; instant: boolean; onChange: (i: number) => void }) {
  // Publish the dock's height so the chat composer can sit just above it (0 when hidden).
  const navRef = useRef<HTMLElement>(null);
  useElementHeightVariable(navRef, "--tabbar-height");
  const { state } = useStore();
  const accent = state.cli === "claude" ? "var(--claude)" : "var(--an-green)";
  const activeIndex = Math.round(position);
  return (
    <nav ref={navRef} className="an-tabbar-shell an-navdock-shell" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}>
      <div className="an-navdock">
        <div className="an-navdock-status">
          <span className="dim">&gt; NAV_DOCK</span>
        </div>
        <div className="an-navdock-bar">
          {/* sliding active fill — engine-tinted, glides between segments */}
          <span
            className="an-navdock-ind"
            style={{
              background: accent,
              transform: `translateX(calc(${position} * 100%))`,
              transition: instant ? "none" : undefined,
            }}
          />
          {TABS.map(({ key, label, Glyph }, i) => {
            const on = activeIndex === i;
            return (
              <button
                key={key}
                type="button"
                aria-label={label}
                aria-current={on ? "page" : undefined}
                onClick={() => onChange(i)}
                className={`an-navseg ${on ? "is-on" : ""}`}
              >
                {on && <span className="an-navseg-dot" />}
                <Glyph />
                <span className="an-navseg-label">{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
