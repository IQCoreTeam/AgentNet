import { useState, useEffect } from "react";
import { useStore } from "../state/store";

// Chat list drawer — the mobile answer to vscode's multi-panel "new tab": instead of
// splitting the screen, the ☰ menu slides this in and you pick ONE chat to show. Telegram
// style. Picking one opens it (cross-CLI resume into the view); "+ New chat" starts a
// fresh one. Only the picked chat is ever on screen — no split, no second panel.
export function Sessions({ onClose }: { onClose: () => void }) {
  const { state, send } = useStore();
  const { storage, cloudSync, googleLoginUrl, googleLoginError } = state;

  const [settingsMode, setSettingsMode] = useState<"list" | "connect" | "gdrive" | "custom">("list");
  const [customUrl, setCustomUrl] = useState("");
  const [customAuth, setCustomAuth] = useState("");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const info = storage?.info as { kind?: string; connected?: boolean; account?: string; location?: string } | null;
  const cloudConnected = !!(info && info.connected && info.kind !== "local");

  // Auto-close settings screen once Google Drive connects successfully
  useEffect(() => {
    if (settingsMode === "gdrive" && info?.kind === "gdrive" && info?.connected) {
      setSettingsMode("list");
      setBusy(false);
    }
  }, [info, settingsMode]);

  // Esc closes the drawer (never a trap)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (settingsMode !== "list") { setSettingsMode("list"); return; }
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [settingsMode, onClose]);

  return (
    <div className="fixed inset-0 z-20 flex" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative flex w-[80vw] max-w-xs flex-col bg-zinc-950 p-3"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))", paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        {settingsMode === "list" ? (
          <>
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

            {/* Storage Mirror Settings at the bottom of the drawer */}
            <div className="mt-auto border-t border-zinc-850 pt-3 flex flex-col gap-2 shrink-0">
              <div className="px-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase flex items-center justify-between">
                <span>Storage Sync</span>
                {cloudConnected && cloudSync && (
                  <span
                    className={`text-[9px] lowercase px-1.5 py-0.5 rounded ${
                      cloudSync.ok ? "bg-green-950/50 text-green-400" : "bg-red-950/50 text-red-400"
                    }`}
                    title={cloudSync.error}
                  >
                    {cloudSync.ok ? "synced" : "sync error"}
                  </span>
                )}
              </div>
              {cloudConnected ? (
                <div className="rounded-lg bg-zinc-900/30 p-2.5 flex flex-col gap-1.5 text-xs border border-zinc-900">
                  <div className="flex justify-between items-center text-zinc-300">
                    <span className="font-medium truncate flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-[#00E673]" />
                      {info?.kind === "gdrive" ? "Google Drive" : "Custom Cloud"}
                    </span>
                    <button
                      onClick={() => send({ type: "disconnectCloud" })}
                      className="text-zinc-500 hover:text-red-400 font-medium active:scale-95 transition"
                    >
                      Disconnect
                    </button>
                  </div>
                  {info?.account && (
                    <span className="text-[10px] text-zinc-500 font-mono truncate">{info.account}</span>
                  )}
                  {info?.location && (
                    <span className="text-[10px] text-zinc-500 font-mono truncate" title={info.location}>
                      {info.location}
                    </span>
                  )}
                  <button
                    onClick={() => send({ type: "openCloud", kind: info!.kind! })}
                    className="w-full rounded bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-[10px] font-medium py-1.5 text-zinc-300 active:scale-95 transition"
                  >
                    Open Mirror Folder
                  </button>
                </div>
              ) : (
                <div className="rounded-lg bg-zinc-900/30 p-2.5 flex justify-between items-center text-xs border border-zinc-900">
                  <span className="text-zinc-500 flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-zinc-700" />
                    Local only (no cloud)
                  </span>
                  <button
                    onClick={() => setSettingsMode("connect")}
                    className="text-[#00E673] hover:text-[#00d068] font-medium active:scale-95 transition"
                  >
                    Connect
                  </button>
                </div>
              )}

              <button
                onClick={() => {
                  send({ type: "disconnectWallet" });
                  onClose();
                }}
                className="text-[10px] text-zinc-600 hover:text-red-400 mt-1 self-start font-medium active:scale-95 transition"
              >
                Disconnect Wallet
              </button>
            </div>
          </>
        ) : settingsMode === "connect" ? (
          <div className="flex flex-col h-full justify-between">
            <div>
              <div className="mb-4 flex items-center justify-between border-b border-zinc-900 pb-2">
                <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                  Connect Cloud
                </span>
                <button
                  onClick={() => setSettingsMode("list")}
                  className="text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Back
                </button>
              </div>
              <div className="flex flex-col gap-2.5">
                <button
                  onClick={() => setSettingsMode("gdrive")}
                  className="w-full text-left rounded-lg border border-zinc-900 bg-zinc-900/20 px-3 py-3 text-xs text-zinc-300 hover:bg-zinc-900/40 active:scale-[0.98] transition"
                >
                  <div className="font-semibold text-zinc-200">Google Drive</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">
                    Mirror sessions to your own Google account
                  </div>
                </button>
                <button
                  onClick={() => setSettingsMode("custom")}
                  className="w-full text-left rounded-lg border border-zinc-900 bg-zinc-900/20 px-3 py-3 text-xs text-zinc-300 hover:bg-zinc-900/40 active:scale-[0.98] transition"
                >
                  <div className="font-semibold text-zinc-200">Custom Storage</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">
                    Mirror sessions to a custom S3/WebDAV/HTTP endpoint
                  </div>
                </button>
              </div>
            </div>
            <button
              onClick={() => setSettingsMode("list")}
              className="w-full rounded-lg bg-zinc-800 hover:bg-zinc-700 py-2.5 text-xs text-zinc-200"
            >
              Cancel
            </button>
          </div>
        ) : settingsMode === "custom" ? (
          <div className="flex flex-col h-full justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-zinc-900 pb-2 mb-4">
                <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                  Custom Cloud
                </span>
                <button
                  onClick={() => setSettingsMode("connect")}
                  className="text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Back
                </button>
              </div>
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-[10px] text-zinc-500 font-semibold uppercase block mb-1">
                    Endpoint URL
                  </label>
                  <input
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full rounded-lg bg-zinc-900 border border-zinc-850 px-2.5 py-2 text-xs text-white outline-none focus:border-[#00E673]/50"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 font-semibold uppercase block mb-1">
                    Auth Header (optional)
                  </label>
                  <input
                    value={customAuth}
                    onChange={(e) => setCustomAuth(e.target.value)}
                    placeholder="Bearer token..."
                    className="w-full rounded-lg bg-zinc-900 border border-zinc-850 px-2.5 py-2 text-xs text-white outline-none focus:border-[#00E673]/50"
                  />
                </div>
                <button
                  disabled={!customUrl.trim()}
                  onClick={() => {
                    send({
                      type: "connectCloud",
                      kind: "custom",
                      location: customUrl.trim(),
                      authHeader: customAuth.trim() || undefined,
                    });
                    setSettingsMode("list");
                  }}
                  className="w-full rounded-lg bg-[#00E673] hover:bg-[#00d068] text-xs font-semibold py-2.5 text-black mt-2 active:scale-95 transition disabled:opacity-40"
                >
                  Connect Storage
                </button>
              </div>
            </div>
            <button
              onClick={() => setSettingsMode("connect")}
              className="w-full rounded-lg bg-zinc-800 hover:bg-zinc-700 py-2.5 text-xs text-zinc-200"
            >
              Cancel
            </button>
          </div>
        ) : (
          /* Google Drive Auth */
          <div className="flex flex-col h-full justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-zinc-900 pb-2 mb-4">
                <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                  Google Drive
                </span>
                <button
                  onClick={() => {
                    if (googleLoginUrl) send({ type: "cancelGoogleLogin" });
                    setSettingsMode("connect");
                  }}
                  className="text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Back
                </button>
              </div>
              <div className="flex flex-col gap-3">
                {!googleLoginUrl ? (
                  <>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setBusy(true);
                        send({ type: "startGoogleLogin" });
                      }}
                      className="w-full rounded-lg bg-[#00E673] hover:bg-[#00d068] text-xs font-semibold py-2.5 text-black mt-1 active:scale-95 transition disabled:opacity-40"
                    >
                      {busy ? "Starting Login…" : "Sign in to Google Drive"}
                    </button>
                    {googleLoginError && (
                      <p className="text-center text-[10px] text-red-400">{googleLoginError}</p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-[10px] text-zinc-400 leading-relaxed">
                      1. Authorize Google Drive access by visiting the link below:
                    </p>
                    <a
                      href={googleLoginUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all rounded-lg bg-zinc-900 px-2.5 py-2 text-[10px] leading-relaxed text-[#00E673] border border-zinc-850 block text-center"
                    >
                      Open Authorization URL
                    </a>
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(googleLoginUrl);
                        } catch {
                          const ta = document.createElement("textarea");
                          ta.value = googleLoginUrl;
                          document.body.appendChild(ta);
                          ta.select();
                          document.execCommand("copy");
                          document.body.removeChild(ta);
                        }
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }}
                      className="w-full rounded bg-zinc-900 border border-zinc-850 hover:bg-zinc-800 text-[10px] font-medium py-1.5 text-zinc-400 active:scale-95 transition"
                    >
                      {copied ? "Copied!" : "Copy link"}
                    </button>
                    <p className="text-[10px] text-zinc-400 leading-relaxed mt-1">
                      2. Paste the redirect URL or authorization code below:
                    </p>
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="Paste URL or code here"
                      className="w-full rounded bg-zinc-900 border border-zinc-850 px-2.5 py-2 text-xs text-white outline-none focus:border-[#00E673]/50"
                    />
                    <button
                      disabled={!code.trim()}
                      onClick={() => {
                        send({ type: "googleAuthCode", code: code.trim() });
                        setCode("");
                      }}
                      className="w-full rounded-lg bg-[#00E673] hover:bg-[#00d068] text-xs font-semibold py-2.5 text-black mt-1 active:scale-95 transition disabled:opacity-40"
                    >
                      Confirm
                    </button>
                  </>
                )}
              </div>
            </div>
            <button
              onClick={() => {
                if (googleLoginUrl) send({ type: "cancelGoogleLogin" });
                setSettingsMode("connect");
              }}
              className="w-full rounded-lg bg-zinc-800 hover:bg-zinc-750 py-2.5 text-xs text-zinc-200"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
