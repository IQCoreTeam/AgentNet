import { useState, useEffect, type ReactNode } from "react";
import { useStore } from "../state/store";
import { openExternalUrl } from "../platform/openExternalUrl";
import { useAutoOpenExternalUrl } from "../platform/useAutoOpenExternalUrl";
import { HeliusKeyForm } from "../settings/HeliusKeyForm";
import { ConnectGithub } from "../onboarding/ConnectGithub";
import { hasAgentService, backgroundExecEnabled, setBackgroundExecEnabled } from "../platform/agentService";

// Chat list drawer — the mobile answer to vscode's multi-panel "new tab": instead of
// splitting the screen, the ☰ menu slides this in and you pick ONE chat to show. Telegram
// style. Picking one opens it (cross-CLI resume into the view); "+ New chat" starts a
// fresh one. Only the picked chat is ever on screen — no split, no second panel.
// One big, bold menu row (icon + label + status subtitle) — the ChatGPT/Claude mobile
// drawer header pattern. Icons are inline SVG (currentColor) so they theme cleanly.
function MenuRow({ icon, label, subtitle, onClick, accent = false }: {
  icon: ReactNode; label: string; subtitle?: string; onClick: () => void; accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3.5 rounded-2xl px-2.5 py-3 text-left transition active:bg-[color:var(--an-bg-2)]"
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center"
        style={{ color: accent ? "var(--an-green)" : "var(--an-fg-dim)" }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[1.12rem] font-semibold leading-tight" style={{ color: "var(--an-fg)" }}>{label}</span>
        {subtitle && <span className="block truncate text-[0.72rem] leading-tight" style={{ color: "var(--an-fg-mute)" }}>{subtitle}</span>}
      </span>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ color: "var(--an-fg-mute)" }}><path d="M5 3l4 4-4 4" /></svg>
    </button>
  );
}

export function Sessions({ onClose, embedded = false }: { onClose: () => void; embedded?: boolean }) {
  const { state, send, openMarket, openMarketAgents, getClientId, notify } = useStore();
  const { storage, cloudSync, googleLoginUrl, googleLoginError } = state;

  const [settingsMode, setSettingsMode] = useState<"list" | "connect" | "gdrive" | "custom" | "helius" | "github">("list");
  const [customUrl, setCustomUrl] = useState("");
  const [customAuth, setCustomAuth] = useState("");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bgExec, setBgExec] = useState(backgroundExecEnabled());
  const [showManualCode, setShowManualCode] = useState(false);

  const info = storage?.info as { kind?: string; connected?: boolean; account?: string; location?: string } | null;
  const cloudConnected = !!(info && info.connected && info.kind !== "local");
  useAutoOpenExternalUrl(googleLoginUrl);

  useEffect(() => {
    send({ type: "getRpcStatus" });
  }, []);

  // Auto-close settings screen once Google Drive connects successfully
  useEffect(() => {
    if (settingsMode === "gdrive" && info?.kind === "gdrive" && info?.connected) {
      setSettingsMode("list");
      setBusy(false);
      setShowManualCode(false);
    }
  }, [info, settingsMode]);

  useEffect(() => {
    if (googleLoginError) setBusy(false);
  }, [googleLoginError]);

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

  const panel = (
      <div
        className={embedded ? "flex h-full w-full flex-col p-3" : "relative flex w-[82vw] max-w-xs flex-col p-3"}
        style={{ background: "var(--an-bg-1)", borderRight: "1px solid var(--an-line)", paddingTop: "max(0.75rem, env(safe-area-inset-top))", paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        {settingsMode === "list" ? (
          <>
            <div className="mb-3 flex items-center justify-between px-1">
              <div>
                <div className="text-[1.45rem] font-semibold leading-none" style={{ color: "var(--an-fg)" }}>
                  AgentNet
                </div>
                <div className="mt-1 font-mono text-[0.72rem]" style={{ color: "var(--an-fg-mute)" }}>
                  {state.walletAddress ? `${state.walletAddress.slice(0, 4)}…${state.walletAddress.slice(-4)}` : "wallet not connected"}
                </div>
              </div>
              <button
                onClick={onClose}
                className="an-iconbtn"
                title="Close menu"
                aria-label="Close menu"
              >
                <svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            </div>

            <div className="space-y-1">
              <MenuRow
                accent
                label="New chat"
                subtitle="Start a fresh agent session"
                onClick={() => {
                  send({ type: "new" });
                  onClose();
                }}
                icon={<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M11 4v14M4 11h14" /></svg>}
              />
              <MenuRow
                label="My Agent"
                subtitle="Profile, published skills, reputation"
                onClick={() => {
                  openMarketAgents();
                  onClose();
                }}
                icon={<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><path d="M11 12.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /><path d="M4.5 18c1.2-2.4 3.3-3.7 6.5-3.7s5.3 1.3 6.5 3.7" /></svg>}
              />
              <MenuRow
                label="Skills"
                subtitle="Browse, buy, publish"
                onClick={() => {
                  openMarket();
                  onClose();
                }}
                icon={<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><path d="M7 5.5h8l2 3.5-6 7.5L5 9l2-3.5Z" /><path d="M5 9h12M9 5.5 8 9l3 7.5L14 9l-1-3.5" /></svg>}
              />
            </div>

            <div className="mt-5">
              <div className="px-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--an-fg-mute)" }}>
                Configure
              </div>
              <div className="mt-1 space-y-0.5">
                <MenuRow
                  label="Storage"
                  subtitle={cloudConnected ? `${info?.account ?? (info?.kind === "gdrive" ? "Google Drive" : "Custom Cloud")}${cloudSync ? ` · ${cloudSync.ok ? "synced" : "sync error"}` : ""}` : "Local only"}
                  onClick={() => setSettingsMode("connect")}
                  icon={<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7.5c0-1.4 3.1-2.5 7-2.5s7 1.1 7 2.5S14.9 10 11 10 4 8.9 4 7.5Z" /><path d="M4 7.5v7c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-7" /><path d="M4 11c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" /></svg>}
                />
                <MenuRow
                  label="Market RPC"
                  subtitle={state.rpcStatus?.hasKey ? `${state.rpcStatus.network} · ${state.rpcStatus.masked}` : "Helius key recommended"}
                  onClick={() => setSettingsMode("helius")}
                  icon={<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4v3M11 15v3M4 11h3M15 11h3" /><path d="m6.5 6.5 2.1 2.1M13.4 13.4l2.1 2.1M15.5 6.5l-2.1 2.1M8.6 13.4l-2.1 2.1" /><circle cx="11" cy="11" r="2.6" /></svg>}
                />
                <MenuRow
                  label="GitHub"
                  subtitle={state.githubStatus?.hasToken ? `connected · ${state.githubStatus.masked ?? "token set"}` : "Private repo access"}
                  onClick={() => { send({ type: "getGithubStatus" }); setSettingsMode("github"); }}
                  icon={<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 16.5c-3 .9-3-1.5-4.2-1.8M15 19v-3.1c0-.8-.3-1.4-.8-1.8 2.6-.3 5.3-1.3 5.3-5.7 0-1.3-.4-2.3-1.2-3.2.1-.3.5-1.6-.1-3.1 0 0-1-.3-3.3 1.2a11.5 11.5 0 0 0-6 0C6.6 1.8 5.6 2.1 5.6 2.1c-.6 1.5-.2 2.8-.1 3.1-.8.9-1.2 2-1.2 3.2 0 4.4 2.7 5.4 5.3 5.7-.4.4-.7.9-.8 1.6V19" /></svg>}
                />
                {/* Android shell only: keep the agent running (and notify on approvals)
                    while the app is backgrounded — but ONLY while a task is active. Off =
                    idle process is reclaimed. Turning OFF mid-turn is foreground-only: the
                    current turn keeps running while the app is open, it just won't survive
                    backgrounding. (#53) */}
                {hasAgentService() && (
                  <>
                    <button
                      onClick={() => {
                        const v = !bgExec;
                        setBgExec(v);
                        setBackgroundExecEnabled(v, getClientId());
                        if (!v && state.typing) notify("Background off — task keeps running while the app is open.");
                      }}
                      className="flex w-full items-center gap-3.5 rounded-2xl px-2.5 py-3 text-left transition active:bg-[color:var(--an-bg-2)]"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center" style={{ color: bgExec ? "var(--an-green)" : "var(--an-fg-dim)" }}>
                        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M11 7v4l2.5 2" /></svg>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[1.12rem] font-semibold leading-tight" style={{ color: "var(--an-fg)" }}>Background execution</span>
                        <span className="block text-[0.72rem] leading-tight" style={{ color: "var(--an-fg-mute)" }}>{bgExec ? "Runs in the background only while a task is active" : "Agent stops when you leave the app"}</span>
                      </span>
                      <span className="relative h-[1.35rem] w-[2.4rem] shrink-0 rounded-full transition" style={{ background: bgExec ? "var(--an-green)" : "var(--an-bg-2)" }}>
                        <span className="absolute top-[0.15rem] h-[1.05rem] w-[1.05rem] rounded-full bg-white transition-all" style={{ left: bgExec ? "1.2rem" : "0.15rem" }} />
                      </span>
                    </button>
                    {bgExec && (
                      <p className="px-2.5 pb-1 text-[0.68rem] leading-snug" style={{ color: "var(--an-fg-mute)" }}>
                        Uses more battery while a task runs in the background. No task = nothing runs.
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="mt-5 flex min-h-0 flex-1 flex-col">
              <div className="mb-2 flex items-center justify-between px-2">
                <span className="text-[0.68rem] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--an-fg-mute)" }}>
                  Recents
                </span>
                <span className="text-[0.72rem]" style={{ color: "var(--an-fg-mute)" }}>
                  {state.sessions.length}
                </span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {state.sessions.length === 0 && (
                  <p className="px-2 py-5 text-[0.95rem]" style={{ color: "var(--an-fg-mute)" }}>No chats yet.</p>
                )}
                {state.sessions.map((s) => {
                  const active = s.sessionId === state.activeSessionId;
                  return (
                    <div
                      key={s.sessionId}
                      className="group flex items-center gap-2 rounded-2xl px-2.5 py-2.5 active:bg-[color:var(--an-bg-2)]"
                      style={active ? { background: "var(--an-bg-2)" } : undefined}
                    >
                      <span
                        className="h-8 w-1 shrink-0 rounded-full"
                        style={{ background: active ? "var(--an-green)" : "transparent" }}
                      />
                      <button
                        onClick={() => {
                          send({ type: "open", sessionId: s.sessionId });
                          onClose();
                        }}
                        className="min-w-0 flex-1 truncate text-left text-[1.02rem] font-medium"
                        style={{ color: "var(--an-fg)" }}
                      >
                        {s.title || "(untitled)"}
                      </button>
                      <button
                        onClick={() => send({ type: "delete", sessionId: s.sessionId })}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full active:bg-red-500/15"
                        style={{ color: "var(--an-fg-mute)" }}
                        title="Delete"
                        aria-label="Delete chat"
                      >
                        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                          <path d="M5 5l10 10M15 5L5 15" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              onClick={() => {
                send({ type: "disconnectWallet" });
                onClose();
              }}
              className="mt-3 self-start px-2 text-[0.76rem] font-medium"
              style={{ color: "var(--an-fg-mute)" }}
            >
              Disconnect wallet
            </button>
          </>
        ) : settingsMode === "helius" ? (
          <div className="flex flex-col h-full">
            <div className="mb-4 flex items-center justify-between border-b border-zinc-900 pb-2">
              <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                Market RPC
              </span>
              <button
                onClick={() => setSettingsMode("list")}
                className="text-xs text-zinc-400 hover:text-zinc-200"
              >
                Back
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <HeliusKeyForm onDone={() => setSettingsMode("list")} />
            </div>
          </div>
        ) : settingsMode === "github" ? (
          <div className="flex flex-col h-full">
            <div className="mb-4 flex items-center justify-between border-b border-zinc-900 pb-2">
              <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                GitHub
              </span>
              <button
                onClick={() => setSettingsMode("list")}
                className="text-xs text-zinc-400 hover:text-zinc-200"
              >
                Back
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <ConnectGithub onDone={() => setSettingsMode("list")} />
            </div>
          </div>
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
                        setShowManualCode(false);
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
                    <p className="text-[10px] text-zinc-400 leading-relaxed text-center">
                      Google sign-in opened in your browser. Approve Drive access, then return to AgentNet.
                    </p>
                    <button
                      onClick={() => openExternalUrl(googleLoginUrl)}
                      className="w-full rounded-lg bg-zinc-900 border border-zinc-850 hover:bg-zinc-800 text-[10px] font-medium py-2 text-zinc-300 active:scale-95 transition"
                    >
                      Open Google Again
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowManualCode((v) => !v)}
                      className="text-[10px] font-medium text-zinc-500 active:text-zinc-300"
                    >
                      {showManualCode ? "Hide manual code entry" : "Having trouble? Use code manually"}
                    </button>
                    {showManualCode && (
                      <>
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
                  </>
                )}
              </div>
            </div>
            <button
              onClick={() => {
                if (googleLoginUrl) send({ type: "cancelGoogleLogin" });
                setBusy(false);
                setShowManualCode(false);
                setSettingsMode("connect");
              }}
              className="w-full rounded-lg bg-zinc-800 hover:bg-zinc-750 py-2.5 text-xs text-zinc-200"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
  );

  if (embedded) return panel;

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      {panel}
    </div>
  );
}
