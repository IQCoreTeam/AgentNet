import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { MessageList } from "./MessageList";
import { ApprovalDock } from "./ApprovalDock";
import { Composer } from "./Composer";
import { Sessions } from "./Sessions";
import { ConnectGithub } from "../onboarding/ConnectGithub";
import { SkillIcon } from "../icons";

// Chat shell: header (sessions toggle + wallet) over the scrolling log, with the approval
// dock + composer pinned at the bottom. Uses --vvh (visual viewport height) so the layout
// shrinks above the on-screen keyboard instead of being covered by it.
export function ChatScreen() {
  const { state, openMarket, send, clearFiringSkill } = useStore();
  const [drawer, setDrawer] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  // Clear the firing skill glow after the dwell time
  const firingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (state.firingSkill) {
      if (firingTimer.current) clearTimeout(firingTimer.current);
      firingTimer.current = setTimeout(() => {
        clearFiringSkill();
      }, 1400);
    }
    return () => { if (firingTimer.current) clearTimeout(firingTimer.current); };
  }, [state.firingSkill, clearFiringSkill]);

  const addr = state.walletAddress;
  // The header title is the active chat's name (vscode shows it per-panel; here there's
  // one panel, so it names the chat the drawer last opened). Falls back to the brand.
  const activeTitle =
    state.sessions.find((s) => s.sessionId === state.activeSessionId)?.title || "New chat";
  return (
    <div className="flex flex-col" style={{ height: "var(--vvh, 100dvh)" }}>
      <header
        className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
      >
        <button
          onClick={() => setDrawer(true)}
          className="shrink-0 px-1 text-lg text-zinc-400 active:text-zinc-200"
          title="Chats"
          aria-label="Open chat list"
        >
          ☰
        </button>
        <span className="truncate text-sm font-medium">{activeTitle}</span>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {state.firingSkill && (
            <span className="inline-flex items-center gap-1 text-xs text-green-400 animate-pulse skill-firing-badge">
              <SkillIcon className="h-3.5 w-3.5" /> {state.firingSkill}
            </span>
          )}
          <button
            onClick={() => { send({ type: "getGithubStatus" }); setGithubOpen(true); }}
            className={`text-xs border rounded-lg px-2 py-1 active:bg-zinc-800 ${state.githubStatus?.hasToken ? "text-green-400 border-green-700/50" : "text-zinc-400 border-zinc-700"}`}
            title="GitHub token"
          >
            {state.githubStatus?.hasToken ? "⎇" : "⎇?"}
          </button>
          <button
            onClick={openMarket}
            className="text-xs text-zinc-400 border border-zinc-700 rounded-lg px-2 py-1 active:bg-zinc-800"
          >
            Markets
          </button>
          {addr && (
            <span className="font-mono text-xs text-zinc-500">
              {addr.slice(0, 4)}…{addr.slice(-4)}
            </span>
          )}
        </div>
      </header>

      {state.loading && (
        <div className="bg-zinc-900 px-3 py-1 text-center text-xs text-zinc-500">
          carrying session…
        </div>
      )}

      <MessageList />
      <ApprovalDock />
      <Composer />

      {drawer && <Sessions onClose={() => setDrawer(false)} />}
      {githubOpen && (
        <div className="absolute inset-0 z-50 bg-zinc-950">
          <ConnectGithub onDone={() => setGithubOpen(false)} />
        </div>
      )}
    </div>
  );
}
