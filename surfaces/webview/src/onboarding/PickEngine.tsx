// Engine picker — the screen after wallet connect. The user chooses which agent engine to
// activate (Claude or Codex) instead of being forced through Claude. The chosen engine
// becomes the active tab and runs its own gate next: Claude → subscription login if it's
// logged out; Codex → "coming soon" (its login flow + interactive approvals aren't wired
// yet — codex-sdk exposes approvalPolicy only, so we don't pretend it works).

import { useState } from "react";
import { OnboardingShell, OnboardingButton } from "./OnboardingShell";
import { useStore } from "../state/store";
import type { EngineStatus } from "../state/store";

// One-line status pill mirroring the CLI's badges, so the user sees up front whether an
// engine is ready / logged out / not installed before picking it.
function StatusPill({ status }: { status: EngineStatus | undefined }) {
  if (status === "ok") return <span className="text-xs text-[#00E673]">● ready</span>;
  if (status === "no-login") return <span className="text-xs text-amber-400">● sign-in needed</span>;
  return <span className="text-xs text-zinc-500">● not installed</span>;
}

function EngineCard({
  name,
  status,
  comingSoon,
  selected,
  onClick,
}: {
  name: string;
  status: EngineStatus | undefined;
  comingSoon?: boolean;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-xl border px-4 py-3.5 text-left transition ${
        selected ? "border-[#00E673] bg-zinc-900" : "border-zinc-700 hover:bg-zinc-800/60"
      }`}
    >
      <span className="flex flex-col gap-1">
        <span className="text-sm font-medium text-zinc-100">
          {name}
          {comingSoon && <span className="ml-2 text-xs text-zinc-500">coming soon</span>}
        </span>
        <StatusPill status={status} />
      </span>
    </button>
  );
}

export function PickEngine() {
  const { state, selectEngine } = useStore();
  const report = state.cliReport;
  // local-only: which card is highlighted, and whether to show the codex coming-soon note.
  const [codexNote, setCodexNote] = useState(false);

  return (
    <OnboardingShell
      title="Choose your engine"
      subtitle="Pick which agent to activate. You can switch later."
    >
      <EngineCard
        name="Claude"
        status={report?.claude}
        selected={!codexNote}
        onClick={() => selectEngine("claude")}
      />
      <EngineCard
        name="Codex"
        status={report?.codex}
        comingSoon
        selected={codexNote}
        onClick={() => setCodexNote(true)}
      />
      {codexNote && (
        <p className="mt-1 text-center text-sm text-amber-400/90">
          Codex isn't ready yet — sign-in and tool approvals aren't wired. Pick Claude for now.
        </p>
      )}
      <OnboardingButton className="mt-1" onClick={() => selectEngine("claude")}>
        Continue with Claude
      </OnboardingButton>
    </OnboardingShell>
  );
}
