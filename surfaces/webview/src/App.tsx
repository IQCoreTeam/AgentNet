import { useStore } from "./state/store";
import { ConnectWallet } from "./onboarding/ConnectWallet";
import { ConnectStorage } from "./onboarding/ConnectStorage";
import { PickEngine } from "./onboarding/PickEngine";
import { ConnectClaude } from "./onboarding/ConnectClaude";
import { ConnectCodex } from "./onboarding/ConnectCodex";
import { ChatScreen } from "./chat/ChatScreen";
import { MarketScreen } from "./market/MarketScreen";
import { Toast } from "./Toast";

// Phase router:
//   connecting   → opening SSE stream / sent `ready`, waiting for init|sessions
//   onboarding   → no runtime yet → connect a wallet
//   storageSelect→ wallet connected → choose cloud/local storage mirror configuration
//   engineSelect → wallet in → pick which engine to activate (claude or codex)
//   claudeAuth   → claude chosen, not logged in → connect the Claude subscription
//   codexAuth    → codex chosen, not logged in → device-auth (open URL, enter code)
//   chat         → runtime ready → the chat shell
export function App() {
  const { state } = useStore();
  return (
    <>
      {state.phase === "connecting" && <Connecting />}
      {state.phase === "onboarding" && <ConnectWallet />}
      {state.phase === "storageSelect" && <ConnectStorage />}
      {state.phase === "engineSelect" && <PickEngine />}
      {state.phase === "claudeAuth" && <ConnectClaude />}
      {state.phase === "codexAuth" && <ConnectCodex />}
      {state.phase === "chat" && !state.marketOpen && <ChatScreen />}
      {state.phase === "chat" && state.marketOpen && <MarketScreen />}
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
