import { useState, useEffect, useRef, type ReactNode, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useStore } from "../state/store";
import { IqLogo, AgentIcon } from "../icons";
import { useOnline } from "../layoutEffects";
import agentnetWordmark from "../assets/agentnet.png";
import { haptics } from "../haptics";

// wifi-off mark for the offline states (no emoji; inline SVG per the design rules).
function WifiOffIcon({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="m2 2 20 20" />
      <path d="M8.5 16.4a5 5 0 0 1 6.3-.6" />
      <path d="M5 12.9a10 10 0 0 1 5.2-2.7" />
      <path d="M19 12.9a10 10 0 0 0-2-1.5" />
      <path d="M2 8.8a15 15 0 0 1 4.2-2.6" />
      <path d="M22 8.8a15 15 0 0 0-11.3-3.8" />
      <path d="M12 20h.01" />
    </svg>
  );
}
import { forgetAndroidWallet } from "../onboarding/androidWallet";
import { openExternalUrl } from "../platform/openExternalUrl";
import { useAutoOpenExternalUrl } from "../platform/useAutoOpenExternalUrl";
import { HeliusKeyForm } from "../settings/HeliusKeyForm";
import { ConnectGithub } from "../onboarding/ConnectGithub";
import {
  hasAgentService,
  backgroundExecEnabled,
  screenOffExecEnabled,
  setBackgroundExecEnabled,
  setScreenOffExecEnabled,
} from "../platform/agentService";

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
      className="flex w-full items-center gap-3.5 px-1 py-4 text-left transition active:opacity-80"
      style={{ borderBottom: "1px solid #1a1a1d" }}
    >
      <span
        className="flex h-[40px] w-[40px] shrink-0 items-center justify-center"
        style={{ color: accent ? "var(--an-green)" : "#cfcfcf", border: "1px solid #232327" }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="an-term-mono block text-[17px] font-bold uppercase leading-tight" style={{ color: "#f2f2f2", letterSpacing: "0.5px" }}>{label}</span>
        {subtitle && <span className="an-term-mono block truncate text-[10px] uppercase leading-tight" style={{ color: "#6a6a6a", letterSpacing: "0.5px", marginTop: "4px" }}>{subtitle}</span>}
      </span>
      <span className="an-term-mono text-[16px] font-bold" style={{ color: "#4a4a4d" }}>›</span>
    </button>
  );
}

// One row in the Storage radio picker: a filled dot marks the active backend, tap to switch.
// Compact + token-styled to sit naturally in the settings drawer (no emoji / em-dash).
function StorageOption({ active, title, subtitle, onClick }: { active: boolean; title: string; subtitle: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition active:scale-[0.98]"
      style={{
        borderColor: active ? "var(--an-green-line)" : "#18181b",
        background: active ? "var(--an-green-dim)" : "rgba(24,24,27,0.2)",
      }}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border" style={{ borderColor: active ? "var(--an-green)" : "#3f3f46" }}>
        {active && <span className="h-2 w-2 rounded-full" style={{ background: "var(--an-green)" }} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold" style={{ color: "var(--an-fg)" }}>{title}</span>
        <span className="block text-[10px] mt-0.5" style={{ color: "var(--an-fg-mute)" }}>{subtitle}</span>
      </span>
    </button>
  );
}

export function Sessions({ onClose, embedded = false, onOpenAgent }: { onClose: () => void; embedded?: boolean; onOpenAgent?: () => void }) {
  const { state, send, getClientId, notify } = useStore();
  const { storage, cloudSync, googleLoginUrl, googleLoginError } = state;
  const online = useOnline();

  const [settingsMode, setSettingsMode] = useState<"list" | "configure" | "connect" | "gdrive" | "custom" | "helius" | "github">("list");
  const [customUrl, setCustomUrl] = useState("");
  const [customAuth, setCustomAuth] = useState("");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bgExec, setBgExec] = useState(backgroundExecEnabled());
  const [screenOffExec, setScreenOffExec] = useState(screenOffExecEnabled());
  const [showManualCode, setShowManualCode] = useState(false);

  // Long-press a chat row to reveal a delete menu (replaces the always-on per-row x).
  // `pressFired` suppresses the row's open-on-click that would otherwise follow pointerup.
  const [menuFor, setMenuFor] = useState<{ id: string; title: string } | null>(null);
  const pressTimer = useRef<number | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  const pressFired = useRef(false);
  function clearPress() {
    if (pressTimer.current !== null) { clearTimeout(pressTimer.current); pressTimer.current = null; }
    pressOrigin.current = null;
  }
  function startPress(e: ReactPointerEvent, s: { sessionId: string; title?: string }) {
    pressFired.current = false;
    pressOrigin.current = { x: e.clientX, y: e.clientY };
    pressTimer.current = window.setTimeout(() => {
      pressFired.current = true;
      pressTimer.current = null;
      haptics.press();
      setMenuFor({ id: s.sessionId, title: s.title || "(untitled)" });
    }, 480);
  }
  function movePress(e: ReactPointerEvent) {
    const o = pressOrigin.current;
    if (o && (Math.abs(e.clientX - o.x) > 8 || Math.abs(e.clientY - o.y) > 8)) clearPress();
  }

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
        className={embedded ? "relative flex h-full w-full flex-col p-3" : "relative flex w-[82vw] max-w-xs flex-col p-3"}
        style={{ background: "#060608", borderRight: "1px solid #1a1a1d", paddingTop: "max(0.75rem, env(safe-area-inset-top))", paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        {settingsMode === "list" ? (
          <>
            <div className="mb-3 flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <IqLogo className="h-7 w-7 shrink-0" style={{ color: "var(--an-green)" }} />
                <img src={agentnetWordmark} alt="AgentNet" className="h-6 w-auto" />
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

            <div style={{ borderTop: "1px solid #1a1a1d" }}>
              {onOpenAgent && (
                <MenuRow
                  label="My Agent"
                  subtitle="Profile, skills, identity"
                  onClick={onOpenAgent}
                  icon={<AgentIcon className="h-[22px] w-[22px]" />}
                />
              )}
              <MenuRow
                label="Settings"
                subtitle="Storage, RPC, GitHub, wallet"
                onClick={() => setSettingsMode("configure")}
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>}
              />
            </div>

            <div className="mt-5 flex min-h-0 flex-1 flex-col">
              <div className="mb-1 flex items-center justify-between px-1">
                <span className="an-term-mono text-[9px] font-bold uppercase" style={{ color: "#6a6a6a", letterSpacing: "2px" }}>
                  Recents
                </span>
                <span className="an-term-mono text-[9px] font-bold" style={{ color: "#4a4a4d" }}>
                  {state.sessionsSynced ? `[ ${String(state.sessions.length).padStart(2, "0")} ]` : ""}
                </span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1" style={{ touchAction: "pan-y" }}>
                {/* Offline, but some chats are cached: a calm band, then the saved list. */}
                {!online && state.sessions.length > 0 && (
                  <div
                    className="mb-2 flex items-center gap-2 rounded-xl px-3 py-2"
                    style={{ background: "var(--an-bg-2)", border: "1px solid var(--an-line)" }}
                  >
                    <WifiOffIcon className="h-4 w-4 shrink-0" />
                    <span className="text-[0.78rem]" style={{ color: "var(--an-fg-dim)" }}>Offline · showing saved chats</span>
                  </div>
                )}
                {/* Online but the cloud tier failed: this list is silently local-only.
                    Same calm-band pattern as offline; reauth points at the fix. */}
                {online && state.sessionsSynced && (state.sessionsCloud === "reauth" || state.sessionsCloud === "transient") && (
                  <div
                    className="mb-2 flex items-center gap-2 rounded-xl px-3 py-2"
                    style={{ background: "var(--an-bg-2)", border: "1px solid var(--an-line)" }}
                  >
                    <WifiOffIcon className="h-4 w-4 shrink-0" style={{ color: "var(--an-warn, #e5c07b)" }} />
                    <span className="text-[0.78rem]" style={{ color: "var(--an-fg-dim)" }}>
                      {state.sessionsCloud === "reauth"
                        ? "Cloud sync signed out · showing this device only · reconnect in Storage"
                        : "Cloud unreachable · showing this device only"}
                    </span>
                  </div>
                )}
                {/* Offline with nothing cached: a minimal centered state, not an endless spinner. */}
                {!online && state.sessions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center" style={{ color: "var(--an-fg-mute)" }}>
                    <WifiOffIcon className="h-8 w-8" style={{ opacity: 0.6 }} />
                    <div>
                      <p className="text-[0.95rem]" style={{ color: "var(--an-fg-dim)" }}>You're offline</p>
                      <p className="mt-1 text-[0.75rem]">Recent chats sync when you reconnect.</p>
                    </div>
                  </div>
                ) : online && !state.sessionsSynced ? (
                  <p className="flex items-center gap-2 px-2 py-5 text-[0.95rem]" style={{ color: "var(--an-fg-mute)" }}>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    syncing…
                  </p>
                ) : online && state.sessionsSynced && state.sessions.length === 0 ? (
                  <p className="px-2 py-5 text-[0.95rem]" style={{ color: "var(--an-fg-mute)" }}>No chats yet.</p>
                ) : null}
                {state.sessions.map((s) => {
                  const active = s.sessionId === state.activeSessionId;
                  return (
                    <button
                      key={s.sessionId}
                      onPointerDown={(e) => startPress(e, s)}
                      onPointerMove={movePress}
                      onPointerUp={clearPress}
                      onPointerCancel={clearPress}
                      onClick={() => {
                        if (pressFired.current) { pressFired.current = false; return; }
                        send({ type: "open", sessionId: s.sessionId });
                        onClose();
                      }}
                      className={`flex w-full items-center px-2.5 py-3.5 text-left active:opacity-80 ${active ? "an-bracket" : ""}`}
                      style={active ? ({ "--tk": "#7a7a7d", "--bk": "transparent", "--ts": "8px" } as CSSProperties) : undefined}
                    >
                      <span className="an-term-mono min-w-0 flex-1 truncate text-[15px] font-bold" style={{ color: active ? "#f2f2f2" : "#d8d8d8" }}>
                        {s.title || "(untitled)"}
                      </span>
                    </button>
                  );
                })}
                {/* clears the floating New chat pill at the bottom */}
                <div className="h-20 shrink-0" />
              </div>
            </div>

            <button
              className="an-newchat-pill"
              onClick={() => {
                send({ type: "new" });
                onClose();
              }}
            >
              <svg width="16" height="16" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4v14M4 11h14" /></svg>
              New chat
            </button>

            {menuFor && (
              <div className="an-chatmenu-backdrop" onClick={() => setMenuFor(null)}>
                <div className="an-chatmenu" onClick={(e) => e.stopPropagation()}>
                  <div className="an-chatmenu-title truncate">{menuFor.title}</div>
                  <button
                    className="an-chatmenu-item danger"
                    onClick={() => {
                      send({ type: "delete", sessionId: menuFor.id });
                      setMenuFor(null);
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h14M9 6V4.5h4V6M6 6l.8 11a1.5 1.5 0 0 0 1.5 1.4h5.4a1.5 1.5 0 0 0 1.5-1.4L17 6" /></svg>
                    Delete chat
                  </button>
                </div>
              </div>
            )}
          </>
        ) : settingsMode === "configure" ? (
          <div className="flex h-full flex-col">
            <div className="mb-3 flex items-center justify-between px-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Settings</span>
              <button onClick={() => setSettingsMode("list")} className="text-xs text-zinc-400 hover:text-zinc-200">Back</button>
            </div>
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
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
                      if (!v) setScreenOffExec(false);
                      setBackgroundExecEnabled(v, state.typing || state.approvals.length > 0, getClientId());
                      if (!v && state.typing) notify("Background off: task keeps running while the app is open.");
                    }}
                    role="switch"
                    aria-checked={bgExec}
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
                  <button
                    onClick={() => {
                      if (!bgExec) return;
                      const v = !screenOffExec;
                      setScreenOffExec(v);
                      setScreenOffExecEnabled(v, state.typing || state.approvals.length > 0, getClientId());
                    }}
                    disabled={!bgExec}
                    role="switch"
                    aria-checked={screenOffExec}
                    aria-describedby="screen-off-exec-note"
                    className="flex w-full items-center gap-3.5 rounded-2xl px-2.5 py-3 text-left transition enabled:active:bg-[color:var(--an-bg-2)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center" style={{ color: screenOffExec ? "var(--an-green)" : "var(--an-fg-dim)" }}>
                      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16.8 14.6A7 7 0 0 1 7.4 5.2 7 7 0 1 0 16.8 14.6Z" /><path d="M14.8 5.2v2.6M13.5 6.5h2.6" /></svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[1.12rem] font-semibold leading-tight" style={{ color: "var(--an-fg)" }}>Keep working while locked</span>
                      <span className="block text-[0.72rem] leading-tight" style={{ color: "var(--an-fg-mute)" }}>
                        {!bgExec ? "Turn on background execution first" : screenOffExec ? "Keeps active tasks running with the screen off" : "Pauses may occur after the screen turns off"}
                      </span>
                    </span>
                    <span className="relative h-[1.35rem] w-[2.4rem] shrink-0 rounded-full transition" style={{ background: screenOffExec ? "var(--an-green)" : "var(--an-bg-2)" }}>
                      <span className="absolute top-[0.15rem] h-[1.05rem] w-[1.05rem] rounded-full bg-white transition-all" style={{ left: screenOffExec ? "1.2rem" : "0.15rem" }} />
                    </span>
                  </button>
                  <p id="screen-off-exec-note" className="px-2.5 pb-1 text-[0.68rem] leading-snug" style={{ color: "var(--an-fg-mute)" }}>
                    Uses more battery during active tasks. Approval requests and completed turns vibrate on the lock screen.
                  </p>
                </>
              )}
            </div>
            <button
              onClick={() => {
                forgetAndroidWallet(); // clear the Keystore creds so we don't silently reconnect
                send({ type: "disconnectWallet" });
                onClose();
              }}
              className="mt-2 flex w-full items-center gap-3.5 rounded-2xl px-2.5 py-3 text-left transition active:bg-red-500/10"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center" style={{ color: "#f87171" }}>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 4.5H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2.5" /><path d="M14 15l3-4-3-4M17 11H8.5" /></svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[1.12rem] font-semibold leading-tight" style={{ color: "#f87171" }}>Disconnect wallet</span>
                <span className="block text-[0.72rem] leading-tight" style={{ color: "var(--an-fg-mute)" }}>Clears the saved session on this device</span>
              </span>
            </button>
          </div>
        ) : settingsMode === "helius" ? (
          <div className="flex flex-col h-full">
            <div className="mb-4 flex items-center justify-between border-b border-zinc-900 pb-2">
              <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                Market RPC
              </span>
              <button
                onClick={() => setSettingsMode("configure")}
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
            <div className="mb-4 flex items-center gap-2 border-b border-zinc-900 pb-3">
              <button
                onClick={() => setSettingsMode("configure")}
                aria-label="Back"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-zinc-400 transition active:bg-[color:var(--an-bg-2)] active:text-zinc-100"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
              </button>
              <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                GitHub
              </span>
            </div>
            <div className="flex-1 overflow-y-auto flex flex-col gap-4">
              <ConnectGithub onDone={() => setSettingsMode("list")} />
            </div>
          </div>
        ) : settingsMode === "connect" ? (
          <div className="flex flex-col h-full justify-between">
            <div>
              <div className="mb-4 flex items-center justify-between border-b border-zinc-900 pb-2">
                <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                  Storage
                </span>
                <button
                  onClick={() => setSettingsMode("configure")}
                  className="text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Back
                </button>
              </div>
              <div className="flex flex-col gap-2.5">
                {/* Radio picker: the filled dot = the active backend. Local = disconnect any
                    cloud; gdrive/custom open their existing connect flow. */}
                <StorageOption
                  active={!cloudConnected}
                  title="This device only"
                  subtitle="Sessions stay local. No cloud mirror."
                  onClick={() => {
                    if (cloudConnected) send({ type: "disconnectCloud" });
                    setSettingsMode("configure");
                  }}
                />
                <StorageOption
                  active={info?.kind === "gdrive" && !!info?.connected}
                  title="Google Drive"
                  subtitle={
                    info?.kind === "gdrive" && info?.connected
                      ? `Connected${info.account ? ` · ${info.account}` : ""}`
                      : "Mirror sessions to your own Google account"
                  }
                  onClick={() => setSettingsMode("gdrive")}
                />
                <StorageOption
                  active={info?.kind === "custom" && !!info?.connected}
                  title="Custom Storage"
                  subtitle={
                    info?.kind === "custom" && info?.connected
                      ? `Connected${info.location ? ` · ${info.location}` : ""}`
                      : "Mirror to an S3 / WebDAV / HTTP endpoint"
                  }
                  onClick={() => setSettingsMode("custom")}
                />
              </div>
            </div>
            <button
              onClick={() => setSettingsMode("configure")}
              className="w-full rounded-lg bg-zinc-800 hover:bg-zinc-700 py-2.5 text-xs text-zinc-200"
            >
              Done
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
                    className="w-full rounded-lg bg-zinc-900 border border-zinc-850 px-2.5 py-2 text-xs text-white outline-none focus:border-an-green/50"
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
                    className="w-full rounded-lg bg-zinc-900 border border-zinc-850 px-2.5 py-2 text-xs text-white outline-none focus:border-an-green/50"
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
                  className="w-full rounded-lg bg-an-green hover:bg-[#00d068] text-xs font-semibold py-2.5 text-black mt-2 active:scale-95 transition disabled:opacity-40"
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
                      className="w-full rounded-lg bg-an-green hover:bg-[#00d068] text-xs font-semibold py-2.5 text-black mt-1 active:scale-95 transition disabled:opacity-40"
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
                          className="break-all rounded-lg bg-zinc-900 px-2.5 py-2 text-[10px] leading-relaxed text-an-green border border-zinc-850 block text-center"
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
                          className="w-full rounded bg-zinc-900 border border-zinc-850 px-2.5 py-2 text-xs text-white outline-none focus:border-an-green/50"
                        />
                        <button
                          disabled={!code.trim()}
                          onClick={() => {
                            send({ type: "googleAuthCode", code: code.trim() });
                            setCode("");
                          }}
                          className="w-full rounded-lg bg-an-green hover:bg-[#00d068] text-xs font-semibold py-2.5 text-black mt-1 active:scale-95 transition disabled:opacity-40"
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
