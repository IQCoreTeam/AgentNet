import { useStore } from "./state/store";
import { ConnectWallet } from "./onboarding/ConnectWallet";
import { ConnectStorage } from "./onboarding/ConnectStorage";
import { PickEngine } from "./onboarding/PickEngine";
import { ConnectClaude } from "./onboarding/ConnectClaude";
import { ConnectCodex } from "./onboarding/ConnectCodex";
import { ChatScreen } from "./chat/ChatScreen";
import { MarketScreen } from "./market/MarketScreen";
import { Sessions } from "./chat/Sessions";
import { Toast } from "./Toast";
import { useVisualViewportVars } from "./layoutEffects";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { syncAgentService, notifyApproval } from "./platform/agentService";

// Phase router:
//   connecting   → opening SSE stream / sent `ready`, waiting for init|sessions
//   onboarding   → no runtime yet → connect a wallet
//   storageSelect→ wallet connected → choose cloud/local storage mirror configuration
//   engineSelect → wallet in → pick which engine to activate (claude or codex)
//   claudeAuth   → claude chosen, not logged in → connect the Claude subscription
//   codexAuth    → codex chosen, not logged in → device-auth (open URL, enter code)
//   chat         → runtime ready → the chat shell
export function App() {
  const { state, openMarket, closeMarket, getClientId } = useStore();
  useVisualViewportVars();

  // Issue #53: a turn streaming OR a pending approval = active agent work. Keep the
  // Android foreground service (proot runtime) alive only while that's true and the user
  // enabled background exec; demote otherwise. No-op off the Android shell.
  const agentActive = state.typing || state.approvals.length > 0;
  useEffect(() => { syncAgentService(agentActive, getClientId()); }, [agentActive, getClientId]);

  // Backgrounded approval → ask the shell to raise a notification. Fires per new top
  // approval; the shell ignores it when the app is foreground.
  const topApproval = state.approvals[0];
  useEffect(() => {
    if (topApproval) notifyApproval(topApproval.id, topApproval.title, getClientId());
  }, [topApproval?.id, topApproval?.title, getClientId]);

  return (
    <>
      <div className="app-viewport">
        {state.phase === "connecting" && <Connecting />}
        {state.phase === "onboarding" && <ConnectWallet />}
        {state.phase === "storageSelect" && <ConnectStorage />}
        {state.phase === "engineSelect" && <PickEngine />}
        {state.phase === "claudeAuth" && <ConnectClaude />}
        {state.phase === "codexAuth" && <ConnectCodex />}
        {state.phase === "chat" && (
          <ChatDeck
            marketOpen={state.marketOpen}
            openMarket={openMarket}
            closeMarket={closeMarket}
          />
        )}
      </div>
      <Toast />
    </>
  );
}

function ChatDeck({
  marketOpen,
  openMarket,
  closeMarket,
}: {
  marketOpen: boolean;
  openMarket: () => void;
  closeMarket: () => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dragDx, setDragDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; startX: number; startY: number; dx: number; locked: boolean } | null>(null);

  useEffect(() => {
    if (marketOpen) setDrawerOpen(false);
  }, [marketOpen]);

  const page = drawerOpen ? -1 : marketOpen ? 1 : 0;
  const base = -((page + 1) * 100) / 3;
  const maxRight = page === -1 ? 0 : Number.POSITIVE_INFINITY;
  const maxLeft = page === 1 ? 0 : Number.NEGATIVE_INFINITY;
  const clampedDx = Math.max(maxLeft, Math.min(maxRight, dragDx));

  function finishSwipe(dx: number) {
    setDragging(false);
    setDragDx(0);
    drag.current = null;
    const threshold = Math.min(96, window.innerWidth * 0.22);
    if (Math.abs(dx) < threshold) return;
    if (page === 0 && dx < 0) openMarket();
    if (page === 0 && dx > 0) setDrawerOpen(true);
    if (page === 1 && dx > 0) closeMarket();
    if (page === -1 && dx < 0) setDrawerOpen(false);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse") return;
    drag.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, dx: 0, locked: false };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.locked && Math.abs(dx) < 10) return;
    if (!d.locked && Math.abs(dy) > Math.abs(dx)) {
      drag.current = null;
      return;
    }
    d.locked = true;
    d.dx = Math.max(maxLeft, Math.min(maxRight, dx));
    setDragging(true);
    setDragDx(d.dx);
    e.preventDefault();
  }

  function onPointerEnd(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    finishSwipe(d.dx);
  }

  return (
    <div
      className="an-deck"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <div
        className="an-deck-track"
        style={{
          transform: `translate3d(calc(${base}% + ${clampedDx}px), 0, 0)`,
          transition: dragging ? "none" : "transform 260ms cubic-bezier(0.2, 0.85, 0.2, 1)",
        }}
      >
        <section className="an-deck-card an-deck-drawer" aria-hidden={!drawerOpen}>
          <Sessions embedded onClose={() => setDrawerOpen(false)} />
        </section>
        <section className="an-deck-card" aria-hidden={page !== 0}>
          <ChatScreen onOpenDrawer={() => setDrawerOpen(true)} />
        </section>
        <section className="an-deck-card" aria-hidden={!marketOpen}>
          <MarketScreen />
        </section>
      </div>
    </div>
  );
}

function Connecting() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-zinc-500">
      connecting…
    </div>
  );
}
