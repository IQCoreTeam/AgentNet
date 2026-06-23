// Engine picker — the screen after wallet connect. The user chooses which agent engine to
// activate (Claude or Codex). The chosen engine becomes the active tab and runs its own
// gate: Claude → subscription login if logged out; Codex → device-auth if logged out.

import { useState } from "react";
import { OnboardingShell, OnboardingButton } from "./OnboardingShell";
import { useStore } from "../state/store";
import type { EngineStatus } from "../state/store";
import type { Cli } from "../transport/protocol";

function StatusPill({ status }: { status: EngineStatus | undefined }) {
  if (status === "ok") return <span className="text-xs text-an-green">● ready</span>;
  if (status === "no-login") return <span className="text-xs text-amber-400">● sign-in needed</span>;
  return <span className="text-xs text-zinc-500">● not installed</span>;
}

function EngineCard({
  name,
  status,
  selected,
  disabled,
  onClick,
}: {
  name: string;
  status: EngineStatus | undefined;
  selected?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center justify-between rounded-xl border px-4 py-3.5 text-left transition disabled:opacity-40 ${
        selected ? "border-an-green bg-zinc-900" : "border-zinc-700 hover:bg-zinc-800/60"
      }`}
    >
      <span className="flex flex-col gap-1">
        <span className="text-sm font-medium text-zinc-100">{name}</span>
        <StatusPill status={status} />
      </span>
    </button>
  );
}

export function PickEngine() {
  const { state, selectEngine } = useStore();
  const report = state.cliReport;
  const [selected, setSelected] = useState<Cli>("claude");

  return (
    <OnboardingShell
      title="Choose your engine"
      subtitle="Pick which agent to activate. You can switch later."
    >
      <EngineCard
        name="Claude"
        status={report?.claude}
        selected={selected === "claude"}
        onClick={() => setSelected("claude")}
      />
      <EngineCard
        name="Codex"
        status={report?.codex}
        selected={selected === "codex"}
        disabled={report?.codex === "missing"}
        onClick={() => setSelected("codex")}
      />
      <OnboardingButton className="mt-1" onClick={() => selectEngine(selected)}>
        Continue with {selected === "claude" ? "Claude" : "Codex"}
      </OnboardingButton>
    </OnboardingShell>
  );
}
