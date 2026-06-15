// Compact first-run intro. Deliberately app-like - no hero, no marketing. Its only jobs
// are to name the product, set the one idea that makes the rest make sense ("your wallet
// is your agent"), and hand off to wallet connect. Shown only on a true first run (the
// `init` event, i.e. no runtime yet); returning users with a runtime skip straight to chat.

import { OnboardingShell, OnboardingButton } from "./OnboardingShell";
import { useStore } from "../state/store";

export function Welcome() {
  const { welcomeContinue } = useStore();
  return (
    <OnboardingShell
      title="Welcome to AgentNet"
      subtitle="Your wallet is your agent. Connect it, pick the AI you already pay for, and start chatting - everything stays on this device by default."
    >
      <OnboardingButton onClick={welcomeContinue}>Get started</OnboardingButton>
      <p className="text-center text-xs leading-relaxed text-zinc-500">
        Takes about a minute. No AgentNet account needed - just your wallet.
      </p>
    </OnboardingShell>
  );
}
