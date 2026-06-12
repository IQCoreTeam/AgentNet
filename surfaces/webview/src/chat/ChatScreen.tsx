import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { MessageList } from "./MessageList";
import { ApprovalDock } from "./ApprovalDock";
import { Composer } from "./Composer";
import { Sessions } from "./Sessions";

// Chat shell: header (sessions toggle + wallet) over the scrolling log, with the approval
// dock + composer pinned at the bottom. Uses --vvh (visual viewport height) so the layout
// shrinks above the on-screen keyboard instead of being covered by it.
export function ChatScreen() {
  const { state } = useStore();
  const [drawer, setDrawer] = useState(false);

  // Track the visual viewport so the composer stays above the mobile keyboard. We set a
  // CSS var on the root and size the shell to it; on desktop this is just window height.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () =>
      document.documentElement.style.setProperty("--vvh", `${vv.height}px`);
    sync();
    vv.addEventListener("resize", sync);
    return () => vv.removeEventListener("resize", sync);
  }, []);

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
        {addr && (
          <span className="ml-auto shrink-0 font-mono text-xs text-zinc-500">
            {addr.slice(0, 4)}…{addr.slice(-4)}
          </span>
        )}
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
    </div>
  );
}
