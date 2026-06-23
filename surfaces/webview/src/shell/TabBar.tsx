import type { ComponentType, SVGProps } from "react";
import { ChatIcon, MarketIcon, CollectionIcon, AgentIcon } from "../icons";

// The four top-level domains (screen-rearrangement.md §9). Profile = "My Agent",
// so it reuses the agent mark. Labels are kept because the market/collection
// icons are not self-evident (design-system.md §4).
export type TabKey = "chat" | "market" | "skills" | "profile";

const TABS: { key: TabKey; label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { key: "chat", label: "Chat", Icon: ChatIcon },
  { key: "market", label: "Market", Icon: MarketIcon },
  { key: "skills", label: "Skills", Icon: CollectionIcon },
  { key: "profile", label: "Agent", Icon: AgentIcon },
];

// Floating glass capsule bottom nav. Always-visible 4 domains (the discoverable
// side of the NN/g line), styled as a frosted-glass pill so it reads modern, not
// like a 2014 opaque tab bar. Presentational only: parent owns the active tab.
export function TabBar({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  return (
    <nav
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 10px)" }}
    >
      <div className="an-tabbar pointer-events-auto flex items-stretch gap-1 px-2 py-1.5">
        {TABS.map(({ key, label, Icon }) => {
          const on = active === key;
          return (
            <button
              key={key}
              type="button"
              aria-label={label}
              aria-current={on ? "page" : undefined}
              onClick={() => onChange(key)}
              className={`flex min-w-16 flex-col items-center gap-0.5 rounded-full px-3 py-1.5 transition-colors ${
                on ? "text-an-green" : "text-an-fg-mute"
              }`}
            >
              <Icon className="size-6" />
              <span className="text-label font-medium leading-none">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
