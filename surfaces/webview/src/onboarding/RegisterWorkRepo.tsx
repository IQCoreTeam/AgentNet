import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { haptics } from "../haptics";

// One in-flight registration step: a spinner + label while the host works. Success is announced
// by the shared COMPLETE celebration overlay (label GITHUB REGISTERED, fired at the app root), so
// these rows only ever show the working state; a failure names the broken step in the error text.
function StepRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="var(--an-line)" strokeWidth="3" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="var(--an-green)" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </span>
      <span className="text-sm" style={{ color: "var(--an-fg-dim)" }}>{label}</span>
    </div>
  );
}

// Register a GitHub repo as verified work for the skills it used. Lives in the GitHub
// section (the host already holds the token + wallet). The host pushes the public
// .agentnet marker and calls the indexer; this UI picks the repo + skills, shows the two
// steps while it runs, and the result.
export function RegisterWorkRepo() {
  const { state, send, notify } = useStore();
  const [repo, setRepo] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [phase, setPhase] = useState<"form" | "working">("form");
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(state.workRepoResult?.at ?? 0);

  // Load the wallet's owned skills for the picker.
  useEffect(() => { send({ type: "ownedSkills" }); }, []);

  // React only to results that land after this mount / a submit.
  useEffect(() => {
    const r = state.workRepoResult;
    if (!r || r.at === handled.current) return;
    handled.current = r.at;
    if (r.ok) {
      // Success is celebrated by the root COMPLETE overlay; just reset the form for the next one.
      setPhase("form");
      setRepo("");
      setSelected({});
    } else {
      setPhase("form");
      setError(r.error ?? "Registration failed.");
    }
  }, [state.workRepoResult]);

  const hasToken = !!state.githubStatus?.hasToken;
  const owned = state.marketOwned;
  const mints = state.marketOwnedMints;
  const chosen = Object.keys(selected).filter((m) => selected[m]);
  const canSubmit = hasToken && repo.trim().length > 0 && chosen.length > 0;
  // Why Register can't fire yet — a situation-accurate line (not one generic string), in the
  // order the user fills the form. Shown as a toast when the disabled-LOOKING but clickable
  // button is tapped AND inline under it, so a tester who skips the fine print still learns
  // what's missing. null once every requirement is met.
  const blockReason: string | null =
    !hasToken ? "Add a GitHub token above first."
    : repo.trim().length === 0 ? "Enter a repo first: owner/name or a github.com URL."
    : owned.length === 0 ? "You need at least one owned skill to register work. Buy or mint a skill, then link it here."
    : chosen.length === 0 ? "Pick at least one skill this repo used."
    : null;

  function toggle(mint: string) {
    setSelected((s) => ({ ...s, [mint]: !s[mint] }));
  }

  function submit() {
    if (!canSubmit) return;
    haptics.strong();
    setError(null);
    setPhase("working");
    send({ type: "registerWorkRepo", repo: repo.trim(), skillMints: chosen });
  }

  return (
    <div className="flex flex-col gap-4">
      {phase === "working" ? (
        <div className="space-y-3 py-1">
          <StepRow label="Commit .agentnet marker" />
          <StepRow label="Register with the indexer" />
        </div>
      ) : (
        <>
          <p className="an-term-mono text-[10px] leading-relaxed" style={{ color: "#7a7a7a" }}>
            Link a repo you built to the skills it used. We commit a public{" "}
            <span style={{ color: "#9a9a9a" }}>.agentnet</span> marker (your wallet address only) to prove ownership.
          </p>

          {!hasToken && (
            <p className="an-term-mono text-[10px] uppercase" style={{ color: "#e0913e" }}>Add a GitHub token above first.</p>
          )}

          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/name or github.com URL"
            disabled={!hasToken}
            className="an-term-field disabled:opacity-50"
          />

          <div className="flex flex-col gap-3">
            <span className="an-term-label">Skills this repo used</span>
            {owned.length === 0 ? (
              <p className="an-term-mono text-[10px] uppercase" style={{ color: "#5a5a5d" }}>No owned skills yet.</p>
            ) : (
              <div className="flex flex-col gap-3 max-h-44 overflow-y-auto">
                {owned.map((name) => {
                  const mint = mints[name];
                  if (!mint) return null;
                  const on = !!selected[mint];
                  return (
                    <label key={mint} className="flex items-center gap-3 cursor-pointer active:opacity-80">
                      <input type="checkbox" checked={on} onChange={() => toggle(mint)} disabled={!hasToken} className="sr-only" />
                      <span
                        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center"
                        style={{ border: on ? "1px solid #2f6b46" : "1px solid #3a3a3d", background: on ? "#0d160f" : "#0c0c0d" }}
                      >
                        {on && (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                        )}
                      </span>
                      <span className="an-term-mono truncate text-[12px] font-bold" style={{ color: on ? "#f2f2f2" : "#cfcfcf" }}>{name}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {error && (
            <p className="an-term-mono px-3 py-2 text-[10px]" style={{ background: "rgba(0,0,0,0.25)", border: "1px solid var(--an-red)", color: "var(--an-red)" }}>
              {error}
            </p>
          )}

          {/* Disabled-LOOKING (opacity 0.4, matching .an-btn:disabled) but still clickable, so a
              tap explains what's missing via a toast instead of a dead, silent button. */}
          <button
            onClick={() => { if (blockReason) { haptics.error(); notify(blockReason); return; } submit(); }}
            aria-disabled={!!blockReason}
            className="an-btn an-btn-green"
            style={blockReason ? { opacity: 0.4 } : undefined}
          >
            Register repo
          </button>
          {blockReason && (
            <p className="an-term-mono text-[10px] leading-relaxed" style={{ color: "#7a7a7a" }}>{blockReason}</p>
          )}
        </>
      )}
    </div>
  );
}
