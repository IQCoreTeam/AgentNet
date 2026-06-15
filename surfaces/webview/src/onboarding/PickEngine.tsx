// AI connection - the screen after wallet connect. The user picks the assistant they
// already pay for (Claude or Codex). The chosen engine then runs its own gate via
// __selectEngine: Claude -> sign in with your Claude plan if needed; Codex -> sign in with
// your ChatGPT plan if needed.
//
// "Not installed" is treated as a real, friendly UX state (install guidance + recheck),
// never a dead-end toast. API keys are not surfaced here at all - that's an advanced
// fallback inside the engine's own auth screen.

import { useState } from "react";
import { OnboardingShell, OnboardingButton } from "./OnboardingShell";
import { useStore } from "../state/store";
import type { EngineStatus } from "../state/store";
import type { Cli } from "../transport/protocol";

// A small colored dot + label, by status. No glyphs (keeps the source pure ASCII).
function StatusPill({ status }: { status: EngineStatus | undefined }) {
  const tone =
    status === "ok"
      ? { dot: "bg-[#00E673]", text: "text-[#00E673]", label: "Ready" }
      : status === "no-login"
        ? { dot: "bg-amber-400", text: "text-amber-400", label: "Sign-in needed" }
        : status === "missing"
          ? { dot: "bg-zinc-500", text: "text-zinc-500", label: "Not installed" }
          : { dot: "bg-zinc-600", text: "text-zinc-600", label: "Checking..." };
  return (
    <span className={`flex items-center gap-1.5 text-xs ${tone.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {tone.label}
    </span>
  );
}

function EngineCard({
  name,
  tagline,
  status,
  selected,
  onClick,
}: {
  name: string;
  tagline: string;
  status: EngineStatus | undefined;
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
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-zinc-100">{name}</span>
        <span className="text-xs text-zinc-500">{tagline}</span>
      </span>
      <StatusPill status={status} />
    </button>
  );
}

// Per-engine guidance shown when its CLI isn't installed. Plain steps + a docs link, so a
// non-technical user has a clear next action instead of a dead end.
const INSTALL: Record<Cli, { label: string; command: string; signIn: string; href: string; hrefLabel: string }> = {
  claude: {
    label: "Claude Code isn't installed on this device.",
    command: "npm install -g @anthropic-ai/claude-code",
    signIn: "Then run claude once and sign in with your Claude plan.",
    href: "https://docs.claude.com/en/docs/claude-code",
    hrefLabel: "Claude Code install guide",
  },
  codex: {
    label: "The Codex CLI isn't installed on this device.",
    command: "npm install -g @openai/codex",
    signIn: "Then run codex once and sign in with your ChatGPT plan.",
    href: "https://github.com/openai/codex",
    hrefLabel: "Codex CLI guide",
  },
};

function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = command;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="flex items-stretch gap-2">
      <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-zinc-900 px-3 py-2.5 font-mono text-xs text-zinc-200 ring-1 ring-zinc-800">
        {command}
      </code>
      <button
        onClick={copy}
        className="shrink-0 rounded-lg border border-zinc-700 px-3 text-xs text-zinc-300 hover:bg-zinc-800/60"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function InstallGuide({ cli, onRecheck }: { cli: Cli; onRecheck: () => void }) {
  const info = INSTALL[cli];
  const [rechecking, setRechecking] = useState(false);
  function recheck() {
    setRechecking(true);
    onRecheck();
    // We can't know exactly when the status re-arrives; clear the spinner shortly after.
    // The pill updates on its own once a fresh cliStatus event lands.
    setTimeout(() => setRechecking(false), 1500);
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3.5">
      <p className="text-sm leading-relaxed text-zinc-300">{info.label}</p>
      <p className="text-xs text-zinc-500">Install it, then come back and recheck:</p>
      <CopyableCommand command={info.command} />
      <p className="text-xs leading-relaxed text-zinc-500">{info.signIn}</p>
      <a
        href={info.href}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-[#00E673] hover:underline"
      >
        {info.hrefLabel} (opens in a new tab)
      </a>
      <OnboardingButton variant="outline" disabled={rechecking} onClick={recheck}>
        {rechecking ? "Rechecking..." : "I've installed it - recheck"}
      </OnboardingButton>
    </div>
  );
}

export function PickEngine() {
  const { state, send, selectEngine } = useStore();
  const report = state.cliReport;
  const [selected, setSelected] = useState<Cli>("claude");

  const selectedStatus = report ? report[selected] : undefined;
  const isMissing = selectedStatus === "missing";
  const checking = report == null;

  return (
    <OnboardingShell
      title="Connect your AI"
      subtitle="Pick the assistant you already pay for. You can switch anytime."
    >
      <EngineCard
        name="Claude"
        tagline="Use your Claude plan"
        status={report?.claude}
        selected={selected === "claude"}
        onClick={() => setSelected("claude")}
      />
      <EngineCard
        name="Codex"
        tagline="Use your ChatGPT plan"
        status={report?.codex}
        selected={selected === "codex"}
        onClick={() => setSelected("codex")}
      />

      {isMissing ? (
        <InstallGuide cli={selected} onRecheck={() => send({ type: "checkCliStatus" })} />
      ) : (
        <OnboardingButton className="mt-1" disabled={checking} onClick={() => selectEngine(selected)}>
          {checking ? "Checking..." : `Continue with ${selected === "claude" ? "Claude" : "Codex"}`}
        </OnboardingButton>
      )}
    </OnboardingShell>
  );
}
