import { useStore } from "../state/store";

// Chat list drawer — the mobile answer to vscode's multi-panel "new tab": instead of
// splitting the screen, the ☰ menu slides this in and you pick ONE chat to show. Telegram
// style. Picking one opens it (cross-CLI resume into the view); "+ New chat" starts a
// fresh one. Only the picked chat is ever on screen — no split, no second panel.
export function Sessions({ onClose }: { onClose: () => void }) {
  const { state, send } = useStore();

  return (
    <div className="fixed inset-0 z-20 flex" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative flex w-[80vw] max-w-xs flex-col bg-zinc-950 p-3"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 px-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          Chats
        </div>
        <button
          onClick={() => {
            send({ type: "new" });
            onClose();
          }}
          className="mb-3 rounded-lg bg-zinc-800 px-3 py-2 text-sm font-medium active:bg-zinc-700"
        >
          + New chat
        </button>

        <div className="flex-1 overflow-y-auto">
          {state.sessions.length === 0 && (
            <p className="px-1 py-2 text-xs text-zinc-600">No chats yet.</p>
          )}
          {state.sessions.map((s) => {
            const active = s.sessionId === state.activeSessionId;
            return (
              <div
                key={s.sessionId}
                className={`flex items-center gap-2 rounded-lg px-2 py-2.5 text-sm ${
                  active ? "bg-zinc-800" : "active:bg-zinc-900"
                }`}
              >
                {/* active accent bar so the current chat reads at a glance */}
                <span
                  className={`h-5 w-0.5 shrink-0 rounded-full ${active ? "bg-orange-500" : "bg-transparent"}`}
                />
                <button
                  onClick={() => {
                    send({ type: "open", sessionId: s.sessionId });
                    onClose();
                  }}
                  className="flex-1 truncate text-left"
                >
                  {s.title || "(untitled)"}
                </button>
                {/* always visible on touch (no hover on mobile), kept faint */}
                <button
                  onClick={() => send({ type: "delete", sessionId: s.sessionId })}
                  className="shrink-0 px-1 text-zinc-600 active:text-red-400"
                  title="Delete"
                  aria-label="Delete chat"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
