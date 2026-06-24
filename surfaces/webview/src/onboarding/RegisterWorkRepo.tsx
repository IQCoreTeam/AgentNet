import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";

// One registration step row: a spinner while the host works, a check when the whole
// registration succeeds. The host emits only the final outcome, so both steps flip
// together on success; a failure names the broken step in the error text on the form.
function StepRow({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {done ? (
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="var(--an-green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="var(--an-line)" strokeWidth="3" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="var(--an-green)" strokeWidth="3" strokeLinecap="round" />
          </svg>
        )}
      </span>
      <span className="text-sm" style={{ color: done ? "var(--an-fg)" : "var(--an-fg-dim)" }}>{label}</span>
    </div>
  );
}

// Register a GitHub repo as verified work for the skills it used. Lives in the GitHub
// section (the host already holds the token + wallet). The host pushes the public
// .agentnet marker and calls the indexer; this UI picks the repo + skills, shows the two
// steps while it runs, and the result.
export function RegisterWorkRepo() {
  const { state, send } = useStore();
  const [repo, setRepo] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [phase, setPhase] = useState<"form" | "working" | "done">("form");
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
      setPhase("done");
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

  function toggle(mint: string) {
    setSelected((s) => ({ ...s, [mint]: !s[mint] }));
  }

  function submit() {
    if (!canSubmit) return;
    setError(null);
    setPhase("working");
    send({ type: "registerWorkRepo", repo: repo.trim(), skillMints: chosen });
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-zinc-900/60 p-4 ring-1 ring-zinc-800">
      {phase !== "form" ? (
        <div className="space-y-3 py-1">
          <StepRow label="Commit .agentnet marker" done={phase === "done"} />
          <StepRow label="Register with the indexer" done={phase === "done"} />
        </div>
      ) : (
        <>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Register verified work</h3>
            <p className="mt-0.5 text-xs text-zinc-400 leading-relaxed">
              Link a repo you built to the skills it used. We commit a public{" "}
              <span className="font-mono text-zinc-300">.agentnet</span> marker (your wallet address only) to prove ownership.
            </p>
          </div>

          {!hasToken && (
            <p className="text-xs text-amber-400">Add a GitHub token above first.</p>
          )}

          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/name or github.com URL"
            disabled={!hasToken}
            className="rounded-xl bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none ring-1 ring-zinc-800 focus:ring-an-green/50 font-mono disabled:opacity-50"
          />

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-zinc-500">Skills this repo used</span>
            {owned.length === 0 ? (
              <p className="text-xs text-zinc-500">No owned skills yet.</p>
            ) : (
              <div className="flex flex-col gap-1 max-h-44 overflow-y-auto">
                {owned.map((name) => {
                  const mint = mints[name];
                  if (!mint) return null;
                  return (
                    <label key={mint} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-800/60 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!selected[mint]}
                        onChange={() => toggle(mint)}
                        disabled={!hasToken}
                        className="accent-an-green"
                      />
                      <span className="text-sm text-zinc-200 truncate">{name}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {error && (
            <p className="rounded-xl px-3 py-2 text-xs" style={{ background: "rgba(0,0,0,0.25)", border: "1px solid var(--an-red)", color: "var(--an-red)" }}>
              {error}
            </p>
          )}

          <button
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-xl bg-an-green px-3 py-2.5 text-sm font-semibold text-black disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Register repo
          </button>
        </>
      )}
    </div>
  );
}
