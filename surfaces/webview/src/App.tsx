import { useStore } from "./state/store";
import { Welcome } from "./onboarding/Welcome";
import { ConnectWallet } from "./onboarding/ConnectWallet";
import { ConnectStorage } from "./onboarding/ConnectStorage";
import { PickEngine } from "./onboarding/PickEngine";
import { ConnectClaude } from "./onboarding/ConnectClaude";
import { ConnectCodex } from "./onboarding/ConnectCodex";
import { ChatScreen } from "./chat/ChatScreen";
import { Toast } from "./Toast";

// Phase router. The first-run path is deliberately short and humane:
//   connecting   -> opening SSE stream / sent `ready`, waiting for init|sessions
//   welcome      -> compact, app-like intro (first run only) -> "Get started"
//   onboarding   -> connect a Solana wallet (the agent identity)
//   engineSelect -> pick which AI to use (Claude or Codex) - uses your existing plan
//   claudeAuth   -> claude chosen, not logged in -> sign in with your Claude plan
//   codexAuth    -> codex chosen, not logged in -> sign in with your ChatGPT plan
//   chat         -> runtime ready -> the chat shell
//
// Storage is NON-BLOCKING: first-time users default to local-only and reach chat without
// any storage setup. Cloud mirror is offered later from Settings (the chat drawer). The
// `storageSelect` phase + ConnectStorage screen are kept for that later, opt-in path; the
// first-run router no longer routes into them.
export function App() {
  const { state } = useStore();
  return (
    <>
      {state.phase === "connecting" && <Connecting />}
      {state.phase === "welcome" && <Welcome />}
      {state.phase === "onboarding" && <ConnectWallet />}
      {state.phase === "storageSelect" && <ConnectStorage />}
      {state.phase === "engineSelect" && <PickEngine />}
      {state.phase === "claudeAuth" && <ConnectClaude />}
      {state.phase === "codexAuth" && <ConnectCodex />}
      {state.phase === "chat" && <ChatScreen />}
      <Toast />
    </>
  );
}

function Connecting() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-zinc-500">
      connecting...
    </div>
  );
}
