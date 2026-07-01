// Engine entry for onboarding. If at least one engine is already signed in, auto-start with it
// (both ready -> Claude; only one -> that one) — no picker. Only a fresh user with NO engine
// signed in is asked, and then BOTH Claude and Codex are offered together (so a Codex-only user
// isn't stranded on the Claude login). Each choice routes to that engine's own login; switchable
// later in chat. Compact layout so it fits short screens.

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

  // At least one engine signed in -> auto-route (both -> Claude; only one -> that one). No picker.
  useEffect(() => {
    if (anyReady) selectEngine(codexOk && !claudeOk ? "codex" : "claude");
  }, [anyReady, claudeOk, codexOk]);

  // Splash while the first CLI report is still arriving (so a ready user never flashes the
  // picker) or while auto-routing; fall through to the picker only for a no-engine user.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (report) return;
    const t = setTimeout(() => setWaited(true), 1200);
    return () => clearTimeout(t);
  }, [report]);
  if ((!report && !waited) || anyReady) return <Splash />;

  // Fresh user, neither engine signed in → choose which to set up. Claudex (Team mode)
  // is shown too, but it needs BOTH engines, so it's locked until claude + codex are ready.
  const ENGINES = [
    { cli: "claude" as const, label: "Claude", accent: "var(--claude)", desc: "Anthropic · sign in with your Claude plan", locked: false },
    { cli: "codex" as const, label: "Codex", accent: "var(--an-green)", desc: "OpenAI · sign in with your Codex/ChatGPT plan", locked: false },
    { cli: "claudex" as const, label: "Claudex", accent: "var(--claudex)", desc: "Team mode · Claude leads a team of Codex workers — set up both first", locked: !(claudeOk && codexOk) },
  ];
  return (
    <div className="flex h-full flex-col items-center justify-center px-6" style={{ background: "var(--an-bg-0)" }}>
      <img src={agentnetWordmark} alt="AgentNet" className="mb-1 h-8 w-auto max-w-[70%]" />
      <p className="mb-5 text-sm" style={{ color: "var(--an-fg-mute)" }}>Choose an engine to set up</p>
      <div className="flex w-full max-w-[300px] flex-col gap-2.5">
        {ENGINES.map((e) => (
          <button
            key={e.cli}
            onClick={() => { if (!e.locked) selectEngine(e.cli); }}
            disabled={e.locked}
            title={e.locked ? "Sign in to both Claude and Codex to unlock Claudex" : undefined}
            className="flex items-center gap-3 rounded-xl px-4 py-3 text-left transition active:scale-[0.99]"
            style={{ background: "var(--an-bg-1)", border: `1px solid color-mix(in srgb, ${e.accent} 45%, var(--an-line))`, opacity: e.locked ? 0.4 : 1 }}
          >
            {e.cli === "claudex" && (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={e.accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}>
                <circle cx="5" cy="12" r="2.2" /><circle cx="18" cy="6" r="2.2" /><circle cx="18" cy="18" r="2.2" />
                <path d="M7.1 11 15.6 6.9M7.1 13 15.6 17.1" />
              </svg>
            )}
            <span className="min-w-0">
              <span className="block text-base font-bold" style={{ color: e.accent }}>{e.label}</span>
              <span className="mt-0.5 block text-xs" style={{ color: "var(--an-fg-mute)" }}>{e.desc}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="mt-4 text-center text-xs" style={{ color: "var(--an-fg-mute)" }}>You can switch engines anytime in chat.</p>
    </div>
  );
}
