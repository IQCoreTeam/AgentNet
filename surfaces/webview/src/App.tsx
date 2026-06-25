import { useStore } from "./state/store";
import { ConnectWallet } from "./onboarding/ConnectWallet";
import { Splash } from "./onboarding/Splash";
import { ConnectStorage } from "./onboarding/ConnectStorage";
import { PickEngine } from "./onboarding/PickEngine";
import { ConnectClaude } from "./onboarding/ConnectClaude";
import { ConnectCodex } from "./onboarding/ConnectCodex";
import { ChatScreen } from "./chat/ChatScreen";
import { MarketScreen } from "./market/MarketScreen";
import { BuyCelebration } from "./market/BuyCelebration";
import { PublishCelebration } from "./market/PublishCelebration";
import { Sessions } from "./chat/Sessions";
import { TabBar } from "./shell/TabBar";
import { Toast } from "./Toast";
import { useVisualViewportVars, useKeyboardChrome } from "./layoutEffects";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { syncAgentService, notifyApproval, ensureBackgroundConsent } from "./platform/agentService";
import { haptics } from "./haptics";

// Phase router:
//   connecting   → opening SSE stream / sent `ready`, waiting for init|sessions
//   onboarding   → no runtime yet → connect a wallet
//   storageSelect→ wallet connected → choose cloud/local storage mirror configuration
//   engineSelect → wallet in → pick which engine to activate (claude or codex)
//   claudeAuth   → claude chosen, not logged in → connect the Claude subscription
//   codexAuth    → codex chosen, not logged in → device-auth (open URL, enter code)
//   chat         → runtime ready → the tab shell
export function App() {
  const { state, getClientId } = useStore();
  useVisualViewportVars();
  useKeyboardChrome();

  // Issue #53: a turn streaming OR a pending approval = active agent work. Keep the
  // Android foreground service (proot runtime) alive only while that's true and the user
  // enabled background exec; demote otherwise. No-op off the Android shell.
  const agentActive = state.typing || state.approvals.length > 0;
  useEffect(() => { syncAgentService(agentActive, getClientId()); }, [agentActive, getClientId]);

  // Default-on background exec: prompt once for battery-optimization exemption on launch.
  useEffect(() => { ensureBackgroundConsent(); }, []);

  // Backgrounded approval → ask the shell to raise a notification. Fires per new top
  // approval; the shell ignores it when the app is foreground.
  const topApproval = state.approvals[0];
  useEffect(() => {
    if (!topApproval) return;
    // The code/diff/plan body so the notification can show what's being approved.
    const body = topApproval.command || topApproval.plan || topApproval.diff || topApproval.file || "";
    notifyApproval(topApproval.id, topApproval.title, getClientId(), body);
  }, [topApproval?.id, topApproval?.title, getClientId]);

  // A skill bought/published by the agent mid-chat must celebrate at the app root: the
  // market sub-screens that used to own these overlays aren't mounted during a chat, so
  // the buzz + burst never fired. Buy rides the store's transient `buyCelebrate` flag;
  // publish fires once per new successful `publishResult`.
  const [publishCelebrate, setPublishCelebrate] = useState(false);
  const celebratedPublish = useRef<unknown>(null);
  useEffect(() => {
    const r = state.publishResult;
    if (r?.ok && r !== celebratedPublish.current) {
      celebratedPublish.current = r;
      setPublishCelebrate(true);
    }
  }, [state.publishResult]);

  return (
    <>
      <div className="app-viewport">
        {state.phase === "connecting" && <Splash />}
        {state.phase === "onboarding" && <ConnectWallet />}
        {state.phase === "storageSelect" && <ConnectStorage />}
        {state.phase === "engineSelect" && <PickEngine />}
        {state.phase === "claudeAuth" && <ConnectClaude />}
        {state.phase === "codexAuth" && <ConnectCodex />}
        {state.phase === "chat" && <TabShell />}
      </div>
      <Toast />
      {state.buyCelebrate && <BuyCelebration />}
      {publishCelebrate && <PublishCelebration kind={state.publishKind ?? "skill"} onDone={() => setPublishCelebrate(false)} />}
    </>
  );
}

// The 4-domain shell (screen-rearrangement.md §9) as a horizontal pager:
// Chat · Skills · Agent · Market. A single floating glass bar slides its highlight as you
// swipe between pages. Chat stays mounted (composer draft + scroll survive); the market
// machine mounts only for the active page (it shares one store, so multiple live copies
// would fight). Chat history lives in a left push-reveal drawer, opened by a right swipe
// from Chat (page 0) — every other horizontal swipe pages between tabs.
const LAST = 3; // Chat(0) Skills(1) Agent(2) Market(3)

function TabShell() {
  const [idx, setIdx] = useState(0);
  const [pageDrag, setPageDrag] = useState(0);
  const [paging, setPaging] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerDrag, setDrawerDrag] = useState(0);
  const [drawerDragging, setDrawerDragging] = useState(false);
  const drag = useRef<{ id: number; startX: number; startY: number; dx: number; locked: boolean; mode: "drawer" | "page" | null; fromDrawer: boolean } | null>(null);

  const vw = typeof window === "undefined" ? 360 : window.innerWidth;
  const drawerWidth = Math.min(vw * 0.86, 352);

  // Light haptic when the chat slides back into place (closing) — never on opening.
  function changeDrawer(open: boolean) {
    if (drawerOpen && !open) haptics.tap();
    setDrawerOpen(open);
  }

  function onSwipeStart(e: PointerEvent<HTMLDivElement>, fromDrawer: boolean) {
    if (e.pointerType === "mouse") return;
    // Never start a horizontal gesture from a text field; everything else (incl. buttons
    // and cards) may still be swiped — the movement lock keeps taps tapping.
    if (e.target instanceof Element && e.target.closest("input, textarea, select, [data-no-swipe]")) return;
    drag.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, dx: 0, locked: false, mode: null, fromDrawer };
  }

  function onSwipeMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const rawDx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.locked && Math.abs(rawDx) < 8 && Math.abs(dy) < 8) return;
    // Decide horizontal vs vertical. Bias toward horizontal for the drawer-close gesture
    // (over the scrollable menu) so a left swipe anywhere shuts it.
    const drawerCtx = drawerOpen || d.fromDrawer;
    if (!d.locked && Math.abs(dy) > Math.abs(rawDx) * (drawerCtx ? 1.4 : 1)) {
      drag.current = null;
      return;
    }
    if (!d.locked) {
      d.locked = true;
      // drawer = open/close the history sidebar; page = move between tabs.
      if (drawerCtx) d.mode = "drawer";
      else if (idx === 0 && rawDx > 0) d.mode = "drawer"; // right swipe from Chat opens it
      else d.mode = "page";
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* some WebViews can't capture here */ }
    }
    if (d.mode === "drawer") {
      const closing = drawerOpen;
      const dx = closing ? Math.min(0, rawDx) : Math.max(0, rawDx);
      d.dx = Math.max(-drawerWidth, Math.min(drawerWidth, dx));
      setDrawerDragging(true);
      setDrawerDrag(d.dx);
    } else {
      // Rubber-band past the two ends (can't page left of Chat or right of Market).
      let p = rawDx;
      if ((rawDx < 0 && idx >= LAST) || (rawDx > 0 && idx <= 0)) p = rawDx * 0.3;
      d.dx = p;
      setPaging(true);
      setPageDrag(p);
    }
    e.preventDefault();
  }

  function onSwipeEnd(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (d.locked && d.mode === "drawer") {
      // Easy commit both ways: a slight push (~20%) opens, a slight pull-back (~20%) closes.
      const finalProgress = drawerOpen
        ? Math.max(0, Math.min(1, 1 + d.dx / drawerWidth))
        : Math.max(0, Math.min(1, d.dx / drawerWidth));
      changeDrawer(drawerOpen ? finalProgress > 0.8 : finalProgress > 0.2);
    } else if (d.locked && d.mode === "page") {
      const threshold = vw * 0.22;
      if (d.dx <= -threshold && idx < LAST) setIdx(idx + 1);
      else if (d.dx >= threshold && idx > 0) setIdx(idx - 1);
    }
    drag.current = null;
    setDrawerDragging(false);
    setDrawerDrag(0);
    setPaging(false);
    setPageDrag(0);
  }

  const drawerVisible = drawerOpen || drawerDragging;
  const drawerProgress = drawerOpen
    ? Math.max(0, Math.min(1, 1 + drawerDrag / drawerWidth))
    : Math.max(0, Math.min(1, drawerDrag / drawerWidth));

  // Drawer push: the whole surface slides right (no shrink/rounding — reads as a panel).
  const surfaceTx = drawerProgress * drawerWidth;
  // Pager: the 400%-wide track sits at -idx*25%, plus the live drag offset.
  const tabPosition = Math.max(0, Math.min(LAST, idx - pageDrag / vw));
  const goToTab = (i: number) => { setIdx(i); changeDrawer(false); };

  return (
    <div className="an-shell">
      {drawerVisible && (
        <div
          className="an-drawer-base"
          style={{ width: drawerWidth }}
          // Swiping the revealed menu back to the left closes it too (not just the card).
          onPointerDown={(e) => onSwipeStart(e, true)}
          onPointerMove={onSwipeMove}
          onPointerUp={onSwipeEnd}
          onPointerCancel={onSwipeEnd}
        >
          <Sessions
            embedded
            onClose={() => changeDrawer(false)}
            onOpenAgent={() => { setIdx(2); changeDrawer(false); }}
          />
        </div>
      )}

      <div
        className={`an-app-surface${drawerVisible ? " is-open" : ""}`}
        style={{
          transform: `translate3d(${surfaceTx}px, 0, 0)`,
          transition: drawerDragging ? "none" : undefined,
        }}
        onPointerDown={(e) => onSwipeStart(e, false)}
        onPointerMove={onSwipeMove}
        onPointerUp={onSwipeEnd}
        onPointerCancel={onSwipeEnd}
      >
        <div className="an-shell-panels">
          <div
            className="an-pager-track"
            style={{
              transform: `translate3d(calc(${-idx} * 25% + ${pageDrag}px), 0, 0)`,
              transition: paging ? "none" : "transform var(--dur-screen) var(--ease-emphasized-decelerate)",
            }}
          >
            {/* Chat — always mounted so its draft + scroll survive paging. */}
            <div className="an-page">
              <ChatScreen onOpenDrawer={() => changeDrawer(true)} />
            </div>
            <MarketPage marketTab="skills" active={idx === 1} />
            <MarketPage marketTab="profile" active={idx === 2} />
            <MarketPage marketTab="market" active={idx === 3} />
          </div>
        </div>

        <TabBar position={tabPosition} instant={paging} onChange={goToTab} />

        {drawerOpen && !drawerDragging && (
          <div
            className="an-surface-scrim"
            style={{ background: `rgba(0, 0, 0, ${0.3 * drawerProgress})` }}
            onClick={() => changeDrawer(false)}
          />
        )}
      </div>
    </div>
  );
}

// One pager cell for a market tab. Only the active cell mounts the (store-backed)
// MarketScreen; inactive cells show a light placeholder so the shared store isn't driven
// by three live copies at once. Bottom inset clears the floating tab bar.
function MarketPage({ marketTab, active }: { marketTab: "skills" | "profile" | "market"; active: boolean }) {
  return (
    <div className="an-page">
      {active ? (
        <MarketScreen tab={marketTab} />
      ) : (
        <div className="flex h-full items-center justify-center bg-zinc-950">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-transparent" />
        </div>
      )}
    </div>
  );
}

