import { useEffect, useRef } from "react";
import { useStore } from "../state/store";
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
  // Clear the firing skill glow after the dwell time
  const firingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastVibratedSkill = useRef<string | null>(null);
  useEffect(() => {
    if (state.firingSkill && state.firingSkill !== lastVibratedSkill.current) {
      haptics.castStart(); // light double tap as the skill starts casting
      lastVibratedSkill.current = state.firingSkill;
      if (firingTimer.current) clearTimeout(firingTimer.current);
      // dwell scales with name length (matches the vscode marquee), capped at 4s
      const dwell = Math.min(4000, 1600 + state.firingSkill.length * 35);
      firingTimer.current = setTimeout(() => {
        clearFiringSkill();
      }, dwell);
    } else if (!state.firingSkill) {
      lastVibratedSkill.current = null;
    }
    return () => { if (firingTimer.current) clearTimeout(firingTimer.current); };
  }, [state.firingSkill, clearFiringSkill]);

  const addr = state.walletAddress;
  // The header title is the active chat's name (vscode shows it per-panel; here there's
  // one panel, so it names the chat the drawer last opened). Falls back to the brand.
  const activeTitle =
    state.sessions.find((s) => s.sessionId === state.activeSessionId)?.title || "New chat";
  return (
    <div className="relative flex flex-col" style={{ height: "100%", background: "var(--an-bg-0)" }}>
      <header
        className="an-header sticky top-0 z-30 flex items-center gap-1 px-2"
        style={{ paddingTop: "max(0.25rem, env(safe-area-inset-top))", paddingBottom: "0.25rem" }}
      >
        <button
          onClick={onOpenDrawer}
          className="an-iconbtn shrink-0"
          title="Chats"
          aria-label="Open chat list"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <path d="M3 6h14M3 10h14M3 14h14" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[0.95rem] font-semibold leading-tight">{activeTitle}</div>
          {addr && (
            <div className="font-mono text-[0.68rem] leading-tight" style={{ color: "var(--an-fg-mute)" }}>
              {addr.slice(0, 4)}…{addr.slice(-4)}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <StatusBadge waitingApproval={state.approvals.length > 0} working={state.typing} />
          {state.firingSkill && (
            <span className="inline-flex items-center gap-1 text-xs animate-pulse skill-firing-badge" style={{ color: "var(--an-green)" }}>
              <SkillIcon className="h-3.5 w-3.5" /> {state.firingSkill}
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
        <CastingMarquee skill={state.firingSkill} />
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
