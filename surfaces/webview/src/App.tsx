import { useStore } from "./state/store";
import { ConnectWallet } from "./onboarding/ConnectWallet";
import { ChatScreen } from "./chat/ChatScreen";
import { Toast } from "./Toast";

// Phase router: the store flips phase on the dispatcher's handshake events.
//   connecting  → opening the SSE stream / sent `ready`, waiting for init|sessions
//   onboarding  → no runtime yet → connect a wallet
//   chat        → runtime ready → the chat shell
export function App() {
  const { state } = useStore();
  return (
    <>
      {state.phase === "connecting" && <Connecting />}
      {state.phase === "onboarding" && <ConnectWallet />}
      {state.phase === "chat" && <ChatScreen />}
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
