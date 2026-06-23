import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { OnboardingShell, OnboardingButton } from "./OnboardingShell";
import { openExternalUrl } from "../platform/openExternalUrl";

// Pre-fills GitHub's new-token page with the repo scope (write to your repos —
// needed to commit the .agentnet marker) + a description, so a user creates the
// right token in one tap instead of hunting for scopes.
const TOKEN_URL = "https://github.com/settings/tokens/new?scopes=repo&description=AgentNet";

interface Props {
  onDone: () => void;
}

export function ConnectGithub({ onDone }: Props) {
  const { state, send } = useStore();
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);

  // Fetch current status on mount
  useEffect(() => {
    send({ type: "getGithubStatus" });
  }, []);

  const status = state.githubStatus;

  function save() {
    if (!token.trim()) return;
    setSaving(true);
    send({ type: "submitGithubToken", token: token.trim() });
    setTimeout(() => { setSaving(false); onDone(); }, 1200);
  }

  function clear() {
    send({ type: "clearGithubToken" });
    setToken("");
  }

  return (
    <OnboardingShell
      title="GitHub Token"
      subtitle="Lets the agent push commits and sync sessions across devices via GitHub."
    >
      {status?.hasToken ? (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl bg-zinc-900 px-3 py-3 text-sm text-zinc-300 ring-1 ring-zinc-800 font-mono">
            {status.masked ?? "••••••••"}
          </div>
          <p className="text-xs text-green-400 text-center">✓ Token configured</p>
          <OnboardingButton onClick={onDone}>Continue</OnboardingButton>
          <OnboardingButton variant="outline" onClick={clear}>Remove Token</OnboardingButton>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-zinc-400 leading-relaxed">
            Create a{" "}
            <span className="text-zinc-200 font-medium">Personal Access Token</span> (the{" "}
            <span className="text-zinc-200">repo</span> scope is pre-selected), then paste it below.
          </p>
          <OnboardingButton variant="outline" onClick={() => openExternalUrl(TOKEN_URL)}>
            Create token on GitHub →
          </OnboardingButton>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="ghp_…"
            type="password"
            className="rounded-xl bg-zinc-900 px-3 py-3 text-sm text-white outline-none ring-1 ring-zinc-800 focus:ring-[#00E673]/50 font-mono"
          />
          <OnboardingButton disabled={!token.trim() || saving} onClick={save}>
            {saving ? "Saving…" : "Save Token"}
          </OnboardingButton>
          <OnboardingButton variant="outline" onClick={onDone}>Skip for now</OnboardingButton>
        </div>
      )}
    </OnboardingShell>
  );
}
