import { useEffect, useRef, type CSSProperties } from "react";
import { useStore, isApprovalForView } from "../state/store";
import { MessageList } from "./MessageList";
import { ApprovalDock } from "./ApprovalDock";
import { Composer } from "./Composer";
import { CastingMarquee } from "./CastingMarquee";
import { SkillIcon } from "../icons";
import { useElementHeightVariable } from "../layoutEffects";
import { haptics } from "../haptics";

// Chat shell: header (sessions toggle + wallet) over the scrolling log, with the approval
// dock + composer pinned at the bottom. Uses --vvh (visual viewport height) so the layout
// shrinks above the on-screen keyboard instead of being covered by it.
export function ChatScreen({ onOpenDrawer }: { onOpenDrawer: () => void }) {
  const { state, clearFiringSkill } = useStore();
  const controlsRef = useRef<HTMLDivElement>(null);
  useElementHeightVariable(controlsRef, "--chat-float-height");
  // Clear the whole casting strip after the dwell time. The timer resets on each new cast,
  // so a workflow + its chained skills stay up together, then fade once nothing new fires.
  const firingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastVibratedSkill = useRef<string | null>(null);
  const lastFiring = state.firingSkills[state.firingSkills.length - 1]?.name ?? null;
  useEffect(() => {
    if (lastFiring && lastFiring !== lastVibratedSkill.current) {
      haptics.castStart(); // light double tap as a new skill starts casting
      lastVibratedSkill.current = lastFiring;
      if (firingTimer.current) clearTimeout(firingTimer.current);
      // dwell scales with name length (matches the vscode marquee), capped at 4s
      const dwell = Math.min(4000, 1600 + lastFiring.length * 35);
      firingTimer.current = setTimeout(() => {
        clearFiringSkill();
      }, dwell);
    } else if (!lastFiring) {
      lastVibratedSkill.current = null;
    }
    return () => { if (firingTimer.current) clearTimeout(firingTimer.current); };
  }, [lastFiring, clearFiringSkill]);

  const addr = state.walletAddress;
  // The header title is the active chat's name (vscode shows it per-panel; here there's
  // one panel, so it names the chat the drawer last opened). Falls back to the brand.
  const activeTitle =
    state.sessions.find((s) => s.sessionId === state.activeSessionId)?.title || "New chat";
  return (
    <div className="an-chat-screen relative flex flex-col" style={{ height: "100%", background: "var(--an-bg-0)" }}>
      <header
        className="an-header sticky top-0 z-30 flex items-center gap-2.5 px-3.5"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))", paddingBottom: "0.6rem" }}
      >
        <button
          onClick={onOpenDrawer}
          className="an-bracket flex shrink-0 items-center justify-center"
          style={{ width: "38px", height: "38px", border: "1px solid #1f1f23", color: "#cfcfcf", "--ts": "8px", "--bk": "#0d0d0e", "--tk": "#6e6e72" } as CSSProperties}
          title="Chats"
          aria-label="Open chat list"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 7H20M4 12H20M4 17H20" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <div
            className="truncate"
            style={{ fontFamily: "'Space Mono', ui-monospace, monospace", fontWeight: 700, fontSize: "15px", letterSpacing: "0.5px", color: "#f2f2f2", textTransform: "uppercase" }}
          >
            {activeTitle}
          </div>
          {addr && (
            <div
              className="truncate"
              style={{ fontFamily: "'Space Mono', ui-monospace, monospace", fontSize: "9px", letterSpacing: "1px", color: "#6a6a6a", marginTop: "2px" }}
            >
              {addr.slice(0, 4)}…{addr.slice(-4)} <span style={{ color: "#3a3a3a" }}>/</span> <span style={{ fontFamily: "'Noto Sans JP', sans-serif", color: "#5a5a5d" }}>チャット</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <StatusBadge waitingApproval={state.approvals.some((a) => isApprovalForView(a, state.activeSessionId))} working={state.typing} />
          {lastFiring && (
            <span
              className="inline-flex items-center gap-1 text-xs animate-pulse skill-firing-badge"
              style={{ color: state.firingSkills[state.firingSkills.length - 1]?.kind === "workflow" ? "var(--an-amber)" : "var(--an-violet)" }}
            >
              <SkillIcon className="h-3.5 w-3.5" /> {lastFiring}
            </span>
          )}
        </div>
      </header>

      {state.loading && (
        <div className="px-3 py-1 text-center text-xs" style={{ color: "var(--an-fg-mute)", background: "var(--an-bg-1)" }}>
          carrying session…
        </div>
      )}

      <MessageList />
      <div ref={controlsRef} className="an-chat-float">
        <CastingMarquee skills={state.firingSkills} />
        <ApprovalDock />
        <Composer />
      </div>
    </div>
  );
}

// Lifecycle indicator (#53): so the user can always see what the agent is doing. Approval
// wins over working (it's the blocking state). Idle = no badge — an empty header reads as
// "nothing running" more clearly than a muted "idle" chip. Foreground-vs-background isn't
// shown here: a backgrounded WebView can't paint, so that distinction lives on the Android
// notification, which IS the visible surface when backgrounded.
function StatusBadge({ waitingApproval, working }: { waitingApproval: boolean; working: boolean }) {
  if (waitingApproval) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: "var(--an-amber)" }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--an-amber)" }} /> Waiting for approval
      </span>
    );
  }
  if (working) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium animate-pulse" style={{ color: "var(--an-green)" }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--an-green)" }} /> Working
      </span>
    );
  }
  return null;
}
