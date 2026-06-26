// Engine entry for onboarding. If an engine is already set up we DON'T block on a picker:
// both ready -> Claude; only one ready -> that one. But a fresh user with NO engine signed in
// gets a real choice here — otherwise auto-routing to Claude hides Codex entirely and a
// Codex-only user is stranded on the Claude login screen with no way to pick Codex. Each
// choice routes to that engine's own login. Users can still switch later from the composer.
// Compact layout so it fits short screens.

import { useEffect, useState } from "react";
import { Splash } from "./Splash";
import { useStore } from "../state/store";
import agentnetWordmark from "../assets/agentnet.png";

export function PickEngine() {
  const { state, selectEngine } = useStore();
  const report = state.cliReport;
  const claudeOk = report?.claude === "ok";
  const codexOk = report?.codex === "ok";
  const anyReady = !!report && (claudeOk || codexOk);

  // At least one engine ready → auto-route (both → Claude; only one → that one). No picker.
  useEffect(() => {
    if (anyReady) selectEngine(codexOk && !claudeOk ? "codex" : "claude");
  }, [anyReady, claudeOk, codexOk]);

  // Show the splash while the CLI report is still arriving (so ready users never flash the
  // picker), but fall through to the picker if it's slow — a no-engine user must not hang here.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (report) return;
    const t = setTimeout(() => setWaited(true), 1200);
    return () => clearTimeout(t);
  }, [report]);
  if ((!report && !waited) || anyReady) return <Splash />;

  // Fresh user, neither engine signed in → choose which to set up.
  const ENGINES = [
    { cli: "claude" as const, label: "Claude", accent: "var(--claude)", desc: "Anthropic · sign in with your Claude plan" },
    { cli: "codex" as const, label: "Codex", accent: "var(--an-green)", desc: "OpenAI · sign in with your Codex/ChatGPT plan" },
  ];
  return (
    <div className="flex h-full flex-col items-center justify-center px-6" style={{ background: "var(--an-bg-0)" }}>
      <img src={agentnetWordmark} alt="AgentNet" className="mb-1 h-8 w-auto max-w-[70%]" />
      <p className="mb-5 text-sm" style={{ color: "var(--an-fg-mute)" }}>Choose an engine to set up</p>
      <div className="flex w-full max-w-[300px] flex-col gap-2.5">
        {ENGINES.map((e) => (
          <button
            key={e.cli}
            onClick={() => selectEngine(e.cli)}
            className="rounded-xl px-4 py-3 text-left transition active:scale-[0.99]"
            style={{ background: "var(--an-bg-1)", border: `1px solid color-mix(in srgb, ${e.accent} 45%, var(--an-line))` }}
          >
            <span className="block text-base font-bold" style={{ color: e.accent }}>{e.label}</span>
            <span className="mt-0.5 block text-xs" style={{ color: "var(--an-fg-mute)" }}>{e.desc}</span>
          </button>
        ))}
      </div>
      <p className="mt-4 text-center text-xs" style={{ color: "var(--an-fg-mute)" }}>You can switch engines anytime in chat.</p>
    </div>
  );
}
