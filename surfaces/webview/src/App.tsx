import { useStore } from "./state/store";
import { ConnectWallet } from "./onboarding/ConnectWallet";
import { ConnectStorage } from "./onboarding/ConnectStorage";
import { PickEngine } from "./onboarding/PickEngine";
import { ConnectClaude } from "./onboarding/ConnectClaude";
import { ConnectCodex } from "./onboarding/ConnectCodex";
import { ChatScreen } from "./chat/ChatScreen";
import { MarketScreen } from "./market/MarketScreen";
import { Toast } from "./Toast";
import { useVisualViewportVars } from "./layoutEffects";
import { useEffect } from "react";
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
  const { state, getClientId } = useStore();
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
        {state.phase === "chat" && !state.marketOpen && <ChatScreen />}
        {state.phase === "chat" && state.marketOpen && <MarketScreen />}
      </div>
      <Toast />
    </>
  );
}

function Connecting() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-zinc-500">
      connecting…
    </div>
  );
}
