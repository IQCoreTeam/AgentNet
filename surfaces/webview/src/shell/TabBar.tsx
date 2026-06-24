import { useRef, type ComponentType, type SVGProps } from "react";
import { ChatIcon, MarketIcon, CollectionIcon, AgentIcon } from "../icons";
import { useElementHeightVariable } from "../layoutEffects";

// The four top-level domains as an ordered pager (screen-rearrangement.md §9):
// Chat · Skills · Agent · Market. Agent = "My Agent", so it reuses the agent mark.
export type TabKey = "chat" | "skills" | "profile" | "market";

export const TAB_ORDER: TabKey[] = ["chat", "skills", "profile", "market"];

const TABS: { key: TabKey; label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { key: "chat", label: "Chat", Icon: ChatIcon },
  { key: "skills", label: "Skills", Icon: CollectionIcon },
  { key: "profile", label: "Agent", Icon: AgentIcon },
  { key: "market", label: "Market", Icon: MarketIcon },
];

// Floating glass capsule bottom nav. A single highlight pill slides between the four
// equal-width tabs, tracking `position` (a fractional index that follows the page swipe
// live), so the bar glides sideways as the panels page. Presentational: parent owns nav.
export function TabBar({ position, instant, onChange }: { position: number; instant: boolean; onChange: (i: number) => void }) {
  // Publish the bar's height so the chat composer can sit just above the floating bar
  // and the pages can clear it. Goes to 0 when hidden (keyboard).
  const navRef = useRef<HTMLElement>(null);
  useElementHeightVariable(navRef, "--tabbar-height");
  const activeIndex = Math.round(position);
  return (
    <nav
      ref={navRef}
      className="an-tabbar-shell flex shrink-0 justify-center px-4 pt-2"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)" }}
    >
      <div className="an-tabbar relative flex items-stretch px-1.5 py-1.5">
        {/* Sliding active indicator — one tab wide (fixed), translated by the fractional index. */}
        <span
          className="an-tab-indicator"
          style={{
            width: "var(--an-tab-w)",
            transform: `translateX(calc(${position} * var(--an-tab-w)))`,
            transition: instant ? "none" : undefined,
          }}
        />
        {TABS.map(({ key, label, Icon }, i) => {
          const on = activeIndex === i;
          return (
            <button
              key={key}
              type="button"
              aria-label={label}
              aria-current={on ? "page" : undefined}
              onClick={() => onChange(i)}
              className={`an-tab relative z-[1] flex w-[var(--an-tab-w)] flex-col items-center gap-1 px-1 py-1.5 transition-colors ${
                on ? "text-an-green" : "text-an-fg-mute"
              }`}
            >
              <Icon className="size-[22px]" />
              <span className="text-[0.72rem] font-medium leading-none">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
