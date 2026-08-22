import { useState, useEffect, useRef, type ReactNode, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useStore } from "../state/store";
import { IqLogo, AgentIcon, LockIcon, SkillIcon } from "../icons";
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

// circular-arrows mark for the per-session sync affordance (issue #123; inline SVG, no emoji).
function SyncIcon({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}
import { forgetAndroidWallet } from "../onboarding/androidWallet";
import { openExternalUrl } from "../platform/openExternalUrl";
import { useAutoOpenExternalUrl } from "../platform/useAutoOpenExternalUrl";
import { HeliusKeyForm } from "../settings/HeliusKeyForm";
import { ConnectGithub } from "../onboarding/ConnectGithub";
import { isVersionOlder } from "@iqlabs-official/agent-sdk/runtime/engineInstall";
import {
  hasAgentService,
  backgroundExecEnabled,
  screenOffExecEnabled,
  setBackgroundExecEnabled,
  setScreenOffExecEnabled,
} from "../platform/agentService";
import { LockedGate, useUnlock, LinkRow, FUND_GUIDE_URL, type UnlockReason } from "../unlock/UnlockProvider";
import { useT, useLang, LANGS } from "../i18n";
import { M } from "../i18n/messages";

// Chat list drawer — the mobile answer to vscode's multi-panel "new tab": instead of
// splitting the screen, the ☰ menu slides this in and you pick ONE chat to show. Telegram
// style. Picking one opens it (cross-CLI resume into the view); "+ New chat" starts a
// fresh one. Only the picked chat is ever on screen — no split, no second panel.
// One big, bold menu row (icon + label + status subtitle) — the ChatGPT/Claude mobile
// drawer header pattern. Icons are inline SVG (currentColor) so they theme cleanly.
type MenuRowProps = {
  icon: ReactNode; label: string; subtitle?: string; onClick: () => void; accent?: boolean; locked?: boolean;
};

function MenuRow({ icon, label, subtitle, onClick, accent = false, locked = false }: MenuRowProps) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3.5 px-1 py-4 text-left transition active:opacity-80"
      style={{ borderBottom: "1px solid var(--an-term-line)" }}
    >
      <span
        className="flex h-[40px] w-[40px] shrink-0 items-center justify-center"
        style={{ color: accent ? "var(--an-green)" : "var(--an-term-fg-2)", border: "1px solid var(--an-term-line-2)" }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="an-term-mono block text-[17px] font-bold uppercase leading-tight" style={{ color: "var(--an-term-fg)", letterSpacing: "0.5px" }}>{label}</span>
        {subtitle && <span className="an-term-mono block truncate text-[10px] uppercase leading-tight" style={{ color: "var(--an-term-fg-6)", letterSpacing: "0.5px", marginTop: "4px" }}>{subtitle}</span>}
      </span>
      {locked
        ? <LockIcon className="h-4 w-4 shrink-0" style={{ color: "var(--an-green)" }} />
        : <span className="an-term-mono text-[16px] font-bold" style={{ color: "var(--an-term-fg-8)" }}>›</span>}
    </button>
  );
}

function ProgressiveMenuRow({ reason, unlocked, onUnlocked, ...row }: Omit<MenuRowProps, "onClick" | "locked"> & { reason: UnlockReason; unlocked: boolean; onUnlocked: () => void }) {
  if (unlocked) return <MenuRow {...row} onClick={onUnlocked} />;
  return <LockedGate reason={reason} onUnlocked={onUnlocked}><MenuRow {...row} locked onClick={onUnlocked} /></LockedGate>;
}

// Terminal toggle switch (sharp, scanlined) — one place for every settings switch.
function Toggle({ on }: { on: boolean }) {
  return (
    <span className={`an-toggle${on ? " on" : ""}`} aria-hidden="true">
      <span className="an-toggle-knob" />
    </span>
  );
}

// One mobile-friendly header for every settings sub-view: a 44px tap-target back
// button + terminal title, matching the height of the main tab headers.
function SettingsSubHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="mb-4 flex items-center gap-2 border-b border-zinc-900 pb-2.5">
      <button onClick={onBack} aria-label="Back" className="an-iconbtn shrink-0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
      </button>
      <span className="an-term-mono text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--an-fg-dim)" }}>{title}</span>
    </div>
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
        borderColor: active ? "var(--an-green-line)" : "var(--an-term-line)",
        background: active ? "var(--an-green-dim)" : "rgba(24,24,27,0.2)",
      }}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border" style={{ borderColor: active ? "var(--an-green)" : "var(--an-term-line-3)" }}>
        {active && <span className="h-2 w-2 rounded-full" style={{ background: "var(--an-green)" }} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold" style={{ color: "var(--an-fg)" }}>{title}</span>
        <span className="block text-[10px] mt-0.5" style={{ color: "var(--an-fg-mute)" }}>{subtitle}</span>
      </span>
    </button>
  );
}

type SettingsMode = "list" | "configure" | "wallet" | "connect" | "gdrive" | "custom" | "helius" | "github" | "engines" | "language";

export function Sessions({
  onClose,
  embedded = false,
  onOpenAgent,
  onOpenSkills,
  initialMode,
  settingsRoot = false,
}: {
  onClose: () => void;
  embedded?: boolean;
  onOpenAgent?: () => void;
  onOpenSkills?: () => void;
  initialMode?: SettingsMode;
  settingsRoot?: boolean;
}) {
  const { state, send, selectEngine, getClientId, notify } = useStore();
  const { requestUnlock } = useUnlock();
  const t = useT();
  const { lang, setLang } = useLang();
  const { storage, cloudSync, googleLoginUrl, googleLoginError } = state;
  const online = useOnline();
  // Which engines hold live credentials — drives the AI Connections menu (row subtitle + sub-screen).
  const connectedEngines = (["claude", "codex"] as const).filter((c) => state.cliReport?.[c] === "ok");

  const rootMode: SettingsMode = settingsRoot ? "configure" : "list";
  const [settingsMode, setSettingsMode] = useState<SettingsMode>(initialMode ?? rootMode);
  const [customUrl, setCustomUrl] = useState("");
  const [customAuth, setCustomAuth] = useState("");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  // Two-step guard on the My Wallet disconnect: a local wallet's key lives only on this device
  // (no in-app export), so an accidental tap must not wipe it. First tap arms this confirm.
  const [confirmDisc, setConfirmDisc] = useState(false);
  const [bgExec, setBgExec] = useState(backgroundExecEnabled());
  const [screenOffExec, setScreenOffExec] = useState(screenOffExecEnabled());

  // Engine versions are fetched ON DEMAND only: once per app session, the first time AI
  // Connections opens (the server re-pushes fresh numbers after an update). No polling,
  // no boot-time check — this is the only send site.
  useEffect(() => {
    if (settingsMode === "engines" && !state.engineVersions) send({ type: "getEngineVersions" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsMode]);
  const [showManualCode, setShowManualCode] = useState(false);

  // Long-press a chat row to reveal a delete menu (replaces the always-on per-row x).
  // `pressFired` suppresses the row's open-on-click that would otherwise follow pointerup.
  const [menuFor, setMenuFor] = useState<{ id: string; title: string } | null>(null);
  // Confirm sheet for the opt-in per-session sync (issue #123): tapping a Local row
  // opens this instead of the chat, so a pre-wallet session is never opened (and
  // possibly forked) under the wallet identity without an explicit yes.
  const [syncFor, setSyncFor] = useState<{ id: string; title: string } | null>(null);
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
      setMenuFor({ id: s.sessionId, title: s.title || t(M.menu.untitled) });
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
      setSettingsMode(rootMode);
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
      if (settingsMode !== rootMode) { setSettingsMode(rootMode); return; }
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [settingsMode, onClose, rootMode]);

  // Copy the wallet address from the My Wallet sub-screen (clipboard API, textarea fallback for
  // the Android WebView). Reuses the shared `copied` flash state.
  async function copyWalletAddress() {
    if (!state.walletAddress) return;
    haptics.tap();
    try {
      await navigator.clipboard.writeText(state.walletAddress);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = state.walletAddress;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // Gear glyph for the Settings row; reused by the guest (locked, greyed) menu variant so the
  // path lives in one place.
  const settingsIcon = (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
  );

  const panel = (
      <div
        className={embedded ? "relative flex h-full w-full flex-col p-3" : "relative flex w-[82vw] max-w-xs flex-col p-3"}
        style={{ background: "var(--an-term-bg-deep)", borderRight: "1px solid var(--an-term-line)", paddingTop: "max(0.75rem, env(safe-area-inset-top))", paddingBottom: settingsRoot ? "calc(var(--tabbar-height, 0px) + max(0.75rem, env(safe-area-inset-bottom)))" : "max(0.75rem, env(safe-area-inset-bottom))" }}
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

            <div style={{ borderTop: "1px solid var(--an-term-line)" }}>
              {onOpenAgent && (
                <MenuRow
                  label={t(M.menu.myAgent)}
                  subtitle={t(M.menu.myAgentSub)}
                  onClick={onOpenAgent}
                  icon={<AgentIcon className="h-[22px] w-[22px]" />}
                />
              )}
              {state.walletAddress ? (
                <MenuRow
                  label={t(M.menu.settings)}
                  subtitle={t(M.menu.settingsSub)}
                  onClick={() => setSettingsMode("configure")}
                  icon={settingsIcon}
                />
              ) : (
                // Not set up: Settings is greyed and locked behind a single Unlock_AgentNet
                // focus overlay, so the one first step is unmistakable. The plain row returns
                // once a wallet exists.
                <div className="relative">
                  <div style={{ opacity: 0.35, filter: "grayscale(1)", pointerEvents: "none" }} aria-hidden="true">
                    <MenuRow label={t(M.menu.settings)} subtitle={t(M.menu.settingsSub)} onClick={() => {}} icon={settingsIcon} />
                  </div>
                  <button
                    type="button"
                    onClick={() => { onClose(); requestUnlock("identity"); }}
                    className="an-term-mono absolute inset-x-0 flex items-center justify-center gap-2 active:opacity-80"
                    style={{ top: 5, bottom: 5, color: "var(--an-green)", background: "rgba(6,9,7,0.55)", border: "1px dashed var(--an-green-line)", letterSpacing: "0.08em" }}
                    aria-label="Unlock AgentNet"
                  >
                    <LockIcon className="h-4 w-4" />
                    <span className="text-[13px] font-bold uppercase">Unlock_AgentNet</span>
                    <span className="text-[14px] font-extrabold leading-none">›</span>
                  </button>
                </div>
              )}
            </div>

            <div className="mt-5 flex min-h-0 flex-1 flex-col">
              <div className="mb-1 flex items-center justify-between px-1">
                <span className="an-term-mono text-[9px] font-bold uppercase" style={{ color: "var(--an-term-fg-6)", letterSpacing: "2px" }}>
                  {t(M.menu.recents)}
                </span>
                <span className="an-term-mono text-[9px] font-bold" style={{ color: "var(--an-term-fg-8)" }}>
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
                    <span className="text-[0.78rem]" style={{ color: "var(--an-fg-dim)" }}>{t(M.menu.offlineSaved)}</span>
                  </div>
                )}
                {/* Online but the cloud tier failed: this list is silently local-only.
                    Same calm-band pattern as offline; reauth points at the fix. */}
                {online && state.sessionsSynced && (state.sessionsCloud === "reauth" || state.sessionsCloud === "transient") && (
                  <div
                    className="mb-2 flex items-center gap-2 rounded-xl px-3 py-2"
                    style={{ background: "var(--an-bg-2)", border: "1px solid var(--an-line)" }}
                  >
                    <WifiOffIcon className="h-4 w-4 shrink-0" style={{ color: "var(--an-warn)" }} />
                    <span className="text-[0.78rem]" style={{ color: "var(--an-fg-dim)" }}>
                      {state.sessionsCloud === "reauth"
                        ? t(M.menu.cloudSignedOut)
                        : t(M.menu.cloudUnreachable)}
                    </span>
                  </div>
                )}
                {/* Offline with nothing cached: a minimal centered state, not an endless spinner. */}
                {!online && state.sessions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center" style={{ color: "var(--an-fg-mute)" }}>
                    <WifiOffIcon className="h-8 w-8" style={{ opacity: 0.6 }} />
                    <div>
                      <p className="text-[0.95rem]" style={{ color: "var(--an-fg-dim)" }}>{t(M.menu.youreOffline)}</p>
                      <p className="mt-1 text-[0.75rem]">{t(M.menu.recentChatsSync)}</p>
                    </div>
                  </div>
                ) : online && !state.sessionsSynced ? (
                  <p className="flex items-center gap-2 px-2 py-5 text-[0.95rem]" style={{ color: "var(--an-fg-mute)" }}>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    {t(M.menu.syncing)}
                  </p>
                ) : online && state.sessionsSynced && state.sessions.length === 0 ? (
                  <p className="px-2 py-5 text-[0.95rem]" style={{ color: "var(--an-fg-mute)" }}>{t(M.menu.noChats)}</p>
                ) : null}
                {state.sessions.map((s) => {
                  const active = s.sessionId === state.activeSessionId;
                  const running = state.sessionsRunning.includes(s.sessionId);
                  // Pre-wallet session still in the device store (server tags these only
                  // while a wallet is connected). Its row opens the sync confirm, never
                  // the chat: the wallet runtime can't load it, and sending into an empty
                  // same-id chat would fork the history and block the sync forever. No
                  // long-press delete either; the wallet store doesn't hold this session.
                  const local = !!s.local;
                  return (
                    <button
                      key={s.sessionId}
                      onPointerDown={(e) => { if (!local) startPress(e, s); }}
                      onPointerMove={movePress}
                      onPointerUp={clearPress}
                      onPointerCancel={clearPress}
                      onClick={() => {
                        if (pressFired.current) { pressFired.current = false; return; }
                        if (local) {
                          setSyncFor({ id: s.sessionId, title: s.title || t(M.menu.untitled) });
                          return;
                        }
                        send({ type: "open", sessionId: s.sessionId });
                        onClose();
                      }}
                      className={`flex w-full items-center px-2.5 py-3.5 text-left active:opacity-80 ${active ? "an-bracket" : ""}`}
                      style={active ? ({ "--tk": "var(--an-term-fg-5)", "--bk": "transparent", "--ts": "8px" } as CSSProperties) : undefined}
                    >
                      <span className="an-term-mono min-w-0 flex-1 truncate text-[15px] font-bold" style={{ color: running ? "var(--an-run-fg)" : active ? "var(--an-term-fg)" : "var(--an-term-fg-2)" }}>
                        {s.title || t(M.menu.untitled)}
                      </span>
                      {local && (
                        <span className="an-term-mono ml-2 flex flex-none items-center gap-1.5 text-[11px] font-bold" style={{ color: "var(--an-term-fg-6)", letterSpacing: "0.5px" }}>
                          LOCAL
                          <SyncIcon className="h-3.5 w-3.5" style={{ color: "var(--an-green)" }} />
                        </span>
                      )}
                      {running && (
                        <span className="an-term-mono an-run ml-2 flex-none text-[11px] font-bold" style={{ color: "var(--an-run-accent)", letterSpacing: "0.5px" }}>
                          RUN
                        </span>
                      )}
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
              {t(M.menu.newChat)}
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
                    {t(M.menu.deleteChat)}
                  </button>
                </div>
              </div>
            )}

            {/* Opt-in per-session sync confirm (issue #123): show the destination wallet
                address up front, then migrate that ONE session on an explicit yes. */}
            {syncFor && (
              <div className="an-chatmenu-backdrop" onClick={() => setSyncFor(null)}>
                <div className="an-chatmenu" onClick={(e) => e.stopPropagation()}>
                  <div className="an-chatmenu-title truncate">{syncFor.title}</div>
                  <div className="px-3 pb-3">
                    <p className="text-[12px] leading-relaxed" style={{ color: "var(--an-fg-dim)" }}>{t(M.menu.syncConfirm)}</p>
                    <p className="an-term-mono mt-2 break-all border px-2 py-1.5 text-[11px] leading-relaxed" style={{ borderColor: "var(--an-green-line)", background: "var(--an-green-dim)", color: "var(--an-term-fg)" }}>
                      {state.walletAddress}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button className="an-btn an-btn-outline flex-1" onClick={() => setSyncFor(null)}>{t(M.menu.syncKeepLocal)}</button>
                      <button
                        className="an-btn an-btn-green flex-1"
                        onClick={() => {
                          send({ type: "syncSessionToWallet", sessionId: syncFor.id });
                          setSyncFor(null);
                        }}
                      >
                        {t(M.menu.syncAction)}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : settingsMode === "configure" ? (
          <div className="flex h-full flex-col">
            <div className="mb-3 flex items-center justify-between px-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t(M.menu.settings)}</span>
              {!settingsRoot && <button onClick={() => setSettingsMode("list")} className="text-xs text-zinc-400 hover:text-zinc-200">{t(M.settings.back)}</button>}
            </div>
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
              {onOpenSkills && (
                <ProgressiveMenuRow
                  reason="skills"
                  unlocked={!!state.walletAddress}
                  onUnlocked={onOpenSkills}
                  label={t(M.settings.mySkills)}
                  subtitle={state.walletAddress ? `${state.marketOwned.length} ${t(M.settings.owned)}` : t(M.settings.connectWalletForSkills)}
                  icon={<SkillIcon className="h-[22px] w-[22px]" />}
                />
              )}
              {state.walletAddress && (
                <MenuRow
                  label={t(M.settings.myWallet)}
                  subtitle={`${state.walletAddress.slice(0, 4)}…${state.walletAddress.slice(-4)} · ${t(M.settings.addFunds)}`}
                  onClick={() => { setConfirmDisc(false); setSettingsMode("wallet"); }}
                  icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square"><path d="M4 7.5h15v12H4z" /><path d="M4 7.5V5.5h13v2" /><path d="M14 12.5h5v3h-5z" /></svg>}
                />
              )}
              <ProgressiveMenuRow
                reason="sync"
                unlocked={!!state.walletAddress}
                onUnlocked={() => setSettingsMode("connect")}
                label={t(M.settings.storage)}
                subtitle={cloudConnected ? `${info?.account ?? (info?.kind === "gdrive" ? "Google Drive" : t(M.settings.customCloud))}${cloudSync ? ` · ${cloudSync.ok ? t(M.settings.synced) : t(M.settings.syncError)}` : ""}` : t(M.settings.localOnly)}
                icon={<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7.5c0-1.4 3.1-2.5 7-2.5s7 1.1 7 2.5S14.9 10 11 10 4 8.9 4 7.5Z" /><path d="M4 7.5v7c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-7" /><path d="M4 11c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" /></svg>}
              />
              {!state.walletAddress && (
                // Not set up: the wallet, cloud mirror, Market RPC, GitHub and AI Connections
                // rows collapse into one Set up entry, so a new user sees a single obvious next
                // step instead of a wall of locked rows. Buying a skill opens the same unlock.
                <MenuRow
                  accent
                  label={t(M.settings.setUp)}
                  subtitle={t(M.settings.setUpSub)}
                  onClick={() => requestUnlock("identity")}
                  icon={<IqLogo className="h-[22px] w-[22px]" />}
                />
              )}
              {state.walletAddress && (<>
              <MenuRow
                label={t(M.settings.marketRpc)}
                subtitle={state.rpcStatus?.hasKey ? `${state.rpcStatus.network} · ${state.rpcStatus.masked}` : t(M.settings.heliusRecommended)}
                onClick={() => setSettingsMode("helius")}
                icon={<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4v3M11 15v3M4 11h3M15 11h3" /><path d="m6.5 6.5 2.1 2.1M13.4 13.4l2.1 2.1M15.5 6.5l-2.1 2.1M8.6 13.4l-2.1 2.1" /><circle cx="11" cy="11" r="2.6" /></svg>}
              />
              <MenuRow
                label="GitHub"
                subtitle={state.githubStatus?.hasToken ? `${t(M.settings.githubConnected)} · ${state.githubStatus.masked ?? t(M.settings.githubTokenSet)}` : t(M.settings.githubPrivateRepo)}
                onClick={() => { send({ type: "getGithubStatus" }); setSettingsMode("github"); }}
                icon={<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 16.5c-3 .9-3-1.5-4.2-1.8M15 19v-3.1c0-.8-.3-1.4-.8-1.8 2.6-.3 5.3-1.3 5.3-5.7 0-1.3-.4-2.3-1.2-3.2.1-.3.5-1.6-.1-3.1 0 0-1-.3-3.3 1.2a11.5 11.5 0 0 0-6 0C6.6 1.8 5.6 2.1 5.6 2.1c-.6 1.5-.2 2.8-.1 3.1-.8.9-1.2 2-1.2 3.2 0 4.4 2.7 5.4 5.3 5.7-.4.4-.7.9-.8 1.6V19" /></svg>}
              />
              <MenuRow
                label={t(M.settings.aiConnections)}
                subtitle={connectedEngines.length ? `${connectedEngines.join(" + ")} ${t(M.settings.githubConnected)}` : t(M.settings.notSignedIn)}
                onClick={() => setSettingsMode("engines")}
                icon={<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><path d="M11 3v7" /><path d="M6.2 6.2a7 7 0 1 0 9.6 0" /></svg>}
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
                      if (!v && state.typing) notify(t(M.settings.bgOffToast));
                    }}
                    role="switch"
                    aria-checked={bgExec}
                    className="flex w-full items-center gap-3.5 rounded-2xl px-2.5 py-3 text-left transition active:bg-[color:var(--an-bg-2)]"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center" style={{ color: bgExec ? "var(--an-green)" : "var(--an-fg-dim)" }}>
                      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M11 7v4l2.5 2" /></svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="an-term-mono block text-[1.12rem] font-bold uppercase leading-tight" style={{ color: "var(--an-fg)" }}>{t(M.settings.bgRun)}</span>
                      <span className="block text-[0.72rem] leading-tight" style={{ color: "var(--an-fg-mute)" }}>{bgExec ? t(M.settings.bgRunOn) : t(M.settings.bgRunOff)}</span>
                    </span>
                    <Toggle on={bgExec} />
                  </button>
                  {bgExec && (
                    <p className="px-2.5 pb-1 text-[0.68rem] leading-snug" style={{ color: "var(--an-fg-mute)" }}>
                      {t(M.settings.bgRunNote)}
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
                      <span className="an-term-mono block text-[1.12rem] font-bold uppercase leading-tight" style={{ color: "var(--an-fg)" }}>{t(M.settings.runWhileLocked)}</span>
                      <span className="block text-[0.72rem] leading-tight" style={{ color: "var(--an-fg-mute)" }}>
                        {!bgExec ? t(M.settings.runWhileLockedNeedBg) : screenOffExec ? t(M.settings.runWhileLockedOn) : t(M.settings.runWhileLockedOff)}
                      </span>
                    </span>
                    <Toggle on={screenOffExec} />
                  </button>
                  <p id="screen-off-exec-note" className="px-2.5 pb-1 text-[0.68rem] leading-snug" style={{ color: "var(--an-fg-mute)" }}>
                    {t(M.settings.runWhileLockedNote)}
                  </p>
                </>
              )}
              </>)}
              {/* Language lives outside the guest/setup split: a device preference, always shown. */}
              <MenuRow
                label={t(M.settings.language)}
                subtitle={LANGS.find((l) => l.code === lang)?.label ?? "English"}
                onClick={() => setSettingsMode("language")}
                icon={<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="M3 11h16" /><path d="M11 3c2.2 2.1 3.4 5 3.4 8s-1.2 5.9-3.4 8c-2.2-2.1-3.4-5-3.4-8s1.2-5.9 3.4-8Z" /></svg>}
              />
            </div>
            {state.walletAddress ? (
              // Non-destructive status only. Disconnect moved into My Wallet (a deliberate
              // destination) so it can't be fat-fingered from the panel's bottom edge.
              <div className="mt-2">
                <p className="an-sfcap">&gt;{t(M.settings.connectedCap)} · <span style={{ background: "var(--an-bg-2)", color: "var(--an-fg-dim)", padding: "2px 6px" }}>{`${state.walletAddress.slice(0, 4)}…${state.walletAddress.slice(-4)}`}</span> · <span style={{ color: "var(--an-green)" }}>{t(M.settings.online)}</span></p>
              </div>
            ) : (
              // Set up AgentNet now carries the unlock action as a menu row above, so the guest
              // footer is a calm status line, matching the connected case (no thumb-line CTA).
              <div className="mt-2">
                <p className="an-sfcap">&gt;{t(M.settings.notSetUp)} · <span style={{ background: "var(--an-bg-2)", color: "var(--an-fg-dim)", padding: "2px 6px" }}>GUEST</span><span className="unlock-cursor">_</span></p>
              </div>
            )}
          </div>
        ) : settingsMode === "wallet" ? (
          <div className="flex h-full flex-col">
            <SettingsSubHeader title={t(M.settings.myWallet)} onBack={() => { setConfirmDisc(false); setSettingsMode("configure"); }} />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="relative border px-3 py-3" style={{ borderColor: "var(--an-green-line)", background: "var(--an-green-dim)" }}>
                <p className="an-term-mono text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: "var(--an-green)" }}>&gt;{t(M.wallet.addressLabel)}</p>
                <button type="button" onClick={copyWalletAddress} className="an-term-mono absolute right-2 top-2 border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] active:opacity-70" style={{ borderColor: "var(--an-term-line-2)", color: "var(--an-fg-mute)" }}>{copied ? t(M.wallet.copied) : t(M.wallet.copy)}</button>
                <p className="an-term-mono mt-2 break-all pr-12 text-[12px] leading-relaxed" style={{ color: "var(--an-term-fg)" }}>{state.walletAddress}</p>
              </div>
              <div className="mt-3 flex flex-col gap-2">
                <LinkRow label={t(M.wallet.addFundsLabel)} sub={t(M.wallet.addFundsSub)} href={FUND_GUIDE_URL} />
                <LinkRow label={t(M.wallet.explorerLabel)} sub={t(M.wallet.explorerSub)} href={`https://solscan.io/account/${state.walletAddress}`} />
              </div>
              <div className="an-term-mono mt-3 flex justify-between border-t pt-3 text-[10px] uppercase tracking-[0.08em]" style={{ borderColor: "var(--an-term-line)", color: "var(--an-fg-mute)" }}>
                <span>{t(M.wallet.network)}</span><span style={{ color: "var(--an-term-fg-2)" }}>Solana Mainnet</span>
              </div>
            </div>
            {!confirmDisc ? (
              <button onClick={() => setConfirmDisc(true)} className="an-sfcta an-sfcta-disc mt-3">
                <span className="ico">
                  <svg width="20" height="20" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square"><path d="M8.5 4.5H4v13h4.5" /><path d="M14 15l3-4-3-4M17 11H8.5" /></svg>
                </span>
                <span className="grow">
                  <span className="ttl">{t(M.wallet.disconnect)}</span>
                  <span className="sub">{t(M.wallet.disconnectSub)}</span>
                </span>
                <span className="xmk">[x]</span>
              </button>
            ) : (
              <div className="mt-3">
                <div className="border p-3" style={{ borderColor: "var(--an-red)", background: "rgba(229,72,77,0.08)" }}>
                  <p className="an-term-mono text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: "var(--an-red)" }}>&gt;{t(M.wallet.confirmDisconnect)}</p>
                  <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--an-fg-dim)" }}>{t(M.wallet.confirmWarning)}</p>
                </div>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => setConfirmDisc(false)} className="an-btn an-btn-outline flex-1">{t(M.wallet.keepWallet)}</button>
                  <button
                    onClick={() => {
                      forgetAndroidWallet(); // clear the Keystore creds so we don't silently reconnect
                      send({ type: "disconnectWallet" });
                      onClose();
                    }}
                    className="an-btn an-btn-danger flex-1"
                  >
                    {t(M.wallet.disconnectAction)}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : settingsMode === "helius" ? (
          <div className="flex flex-col h-full">
            <SettingsSubHeader title={t(M.settings.marketRpc)} onBack={() => setSettingsMode("configure")} />
            <div className="flex-1 overflow-y-auto">
              <HeliusKeyForm onDone={() => setSettingsMode(rootMode)} />
            </div>
          </div>
        ) : settingsMode === "github" ? (
          <div className="flex flex-col h-full">
            <SettingsSubHeader title="GitHub" onBack={() => setSettingsMode("configure")} />
            <div className="flex-1 overflow-y-auto flex flex-col gap-4">
              <ConnectGithub onDone={() => setSettingsMode(rootMode)} />
            </div>
          </div>
        ) : settingsMode === "engines" ? (
          <div className="flex flex-col h-full">
            <SettingsSubHeader title={t(M.settings.aiConnections)} onBack={() => setSettingsMode("configure")} />
            <div className="flex-1 space-y-0.5 overflow-y-auto">
              {(["claude", "codex"] as const).map((c) => {
                const connected = state.cliReport?.[c] === "ok";
                const accent = c === "claude" ? "var(--claude)" : "var(--an-green)";
                const version = state.engineVersions?.[c];
                const updating = !!state.engineUpdating[c];
                const outdated = !!(version?.installed && version.latest && isVersionOlder(version.installed, version.latest));
                return (
                  <div key={c} className="flex items-center gap-3.5 rounded-2xl px-2.5 py-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center" style={{ color: connected ? accent : "var(--an-fg-dim)" }}>
                      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><path d="M11 3v7" /><path d="M6.2 6.2a7 7 0 1 0 9.6 0" /></svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="an-term-mono block text-[1.12rem] font-bold uppercase leading-tight" style={{ color: "var(--an-fg)" }}>{c}</span>
                      <span className="block text-[0.72rem] leading-tight" style={{ color: connected ? accent : "var(--an-fg-mute)" }}>
                        {connected ? t(M.storagePicker.connected) : t(M.settings.notSignedIn)}
                        {version?.installed ? ` · v${version.installed}` : ""}
                      </span>
                      {outdated && (
                        <span className="block text-[0.72rem] leading-tight" style={{ color: "var(--an-amber, #e90)" }}>
                          {updating ? t(M.engines.updatingLong) : `v${version?.latest} ${t(M.engines.available)}`}
                        </span>
                      )}
                    </span>
                    {outdated && (
                      <button
                        disabled={updating}
                        onClick={() => send({ type: "updateEngine", cli: c })}
                        className="an-term-mono shrink-0 text-[11px] font-bold uppercase tracking-wide transition active:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
                        style={{ color: "var(--an-amber, #e90)", border: "1px solid color-mix(in srgb, var(--an-amber, #e90) 45%, var(--an-line))", padding: "8px 12px" }}
                      >
                        {updating ? t(M.engines.updating) : t(M.engines.update)}
                      </button>
                    )}
                    {connected ? (
                      <button
                        onClick={() => send({ type: "logoutEngine", cli: c })}
                        className="an-term-mono shrink-0 text-[11px] font-bold uppercase tracking-wide transition active:opacity-70"
                        style={{ color: "var(--an-red, #e55)", border: "1px solid var(--an-line)", padding: "8px 12px" }}
                      >
                        {t(M.engines.logOut)}
                      </button>
                    ) : (
                      <button
                        onClick={() => selectEngine(c)}
                        className="an-term-mono shrink-0 text-[11px] font-bold uppercase tracking-wide transition active:opacity-70"
                        style={{ color: accent, border: `1px solid color-mix(in srgb, ${accent} 45%, var(--an-line))`, padding: "8px 12px" }}
                      >
                        {t(M.engines.connect)}
                      </button>
                    )}
                  </div>
                );
              })}
              <p className="px-2.5 pt-1 text-[0.68rem] leading-snug" style={{ color: "var(--an-fg-mute)" }}>
                {t(M.engines.note)}
              </p>
            </div>
          </div>
        ) : settingsMode === "language" ? (
          <div className="flex flex-col h-full">
            <SettingsSubHeader title={t(M.settings.language)} onBack={() => setSettingsMode(rootMode)} />
            <div className="flex flex-col gap-2.5">
              {LANGS.map((l) => {
                const active = lang === l.code;
                return (
                  <button
                    key={l.code}
                    onClick={() => { setLang(l.code); setSettingsMode(rootMode); }}
                    className="flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition active:scale-[0.98]"
                    style={{ borderColor: active ? "var(--an-green-line)" : "var(--an-term-line)", background: active ? "var(--an-green-dim)" : "rgba(24,24,27,0.2)" }}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border" style={{ borderColor: active ? "var(--an-green)" : "var(--an-term-line-3)" }}>
                      {active && <span className="h-2 w-2 rounded-full" style={{ background: "var(--an-green)" }} />}
                    </span>
                    <span className="min-w-0 flex-1 text-xs font-semibold" style={{ color: "var(--an-fg)" }}>{l.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 px-1 text-[10px] leading-relaxed" style={{ color: "var(--an-fg-mute)" }}>
              {t(M.settings.languageHint)}
            </p>
          </div>
        ) : settingsMode === "connect" ? (
          <div className="flex flex-col h-full justify-between">
            <div>
              <SettingsSubHeader title={t(M.settings.storage)} onBack={() => setSettingsMode("configure")} />
              <div className="flex flex-col gap-2.5">
                {/* Radio picker: the filled dot = the active backend. Local = disconnect any
                    cloud; gdrive/custom open their existing connect flow. */}
                <StorageOption
                  active={!cloudConnected}
                  title={t(M.storagePicker.thisDevice)}
                  subtitle={t(M.storagePicker.thisDeviceSub)}
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
                      ? `${t(M.storagePicker.connected)}${info.account ? ` · ${info.account}` : ""}`
                      : t(M.storagePicker.gdriveSub)
                  }
                  onClick={() => setSettingsMode("gdrive")}
                />
                <StorageOption
                  active={info?.kind === "custom" && !!info?.connected}
                  title={t(M.storagePicker.customStorage)}
                  subtitle={
                    info?.kind === "custom" && info?.connected
                      ? `${t(M.storagePicker.connected)}${info.location ? ` · ${info.location}` : ""}`
                      : t(M.storagePicker.customStorageSub)
                  }
                  onClick={() => setSettingsMode("custom")}
                />
              </div>
            </div>
            <button
              onClick={() => setSettingsMode("configure")}
              className="w-full rounded-lg bg-zinc-800 hover:bg-zinc-700 py-2.5 text-xs text-zinc-200"
            >
              {t(M.storagePicker.done)}
            </button>
          </div>
        ) : settingsMode === "custom" ? (
          <div className="flex flex-col h-full justify-between">
            <div>
              <SettingsSubHeader title={t(M.settings.customCloud)} onBack={() => setSettingsMode("connect")} />
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-[10px] text-zinc-500 font-semibold uppercase block mb-1">
                    {t(M.custom.endpointUrl)}
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
                    {t(M.custom.authHeader)}
                  </label>
                  <input
                    value={customAuth}
                    onChange={(e) => setCustomAuth(e.target.value)}
                    placeholder={t(M.custom.bearerPlaceholder)}
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
                    setSettingsMode(rootMode);
                  }}
                  className="w-full rounded-lg bg-an-green hover:bg-[var(--an-green-hover)] text-xs font-semibold py-2.5 text-black mt-2 active:scale-95 transition disabled:opacity-40"
                >
                  {t(M.custom.connectStorage)}
                </button>
              </div>
            </div>
            <button
              onClick={() => setSettingsMode("connect")}
              className="w-full rounded-lg bg-zinc-800 hover:bg-zinc-700 py-2.5 text-xs text-zinc-200"
            >
              {t(M.custom.cancel)}
            </button>
          </div>
        ) : (
          /* Google Drive Auth */
          <div className="flex flex-col h-full justify-between">
            <div>
              <SettingsSubHeader title="Google Drive" onBack={() => { if (googleLoginUrl) send({ type: "cancelGoogleLogin" }); setSettingsMode("connect"); }} />
              {/* Google Drive is a brand name, left as-is; the surrounding copy translates. */}
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
                      className="w-full rounded-lg bg-an-green hover:bg-[var(--an-green-hover)] text-xs font-semibold py-2.5 text-black mt-1 active:scale-95 transition disabled:opacity-40"
                    >
                      {busy ? t(M.gdrive.startingLogin) : t(M.gdrive.signIn)}
                    </button>
                    {googleLoginError && (
                      <p className="text-center text-[10px] text-red-400">{googleLoginError}</p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-[10px] text-zinc-400 leading-relaxed text-center">
                      {t(M.gdrive.instructions)}
                    </p>
                    <button
                      onClick={() => openExternalUrl(googleLoginUrl)}
                      className="w-full rounded-lg bg-zinc-900 border border-zinc-850 hover:bg-zinc-800 text-[10px] font-medium py-2 text-zinc-300 active:scale-95 transition"
                    >
                      {t(M.gdrive.openAgain)}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowManualCode((v) => !v)}
                      className="text-[10px] font-medium text-zinc-500 active:text-zinc-300"
                    >
                      {showManualCode ? t(M.gdrive.hideManual) : t(M.gdrive.useManual)}
                    </button>
                    {showManualCode && (
                      <>
                        <a
                          href={googleLoginUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="break-all rounded-lg bg-zinc-900 px-2.5 py-2 text-[10px] leading-relaxed text-an-green border border-zinc-850 block text-center"
                        >
                          {t(M.gdrive.openAuthUrl)}
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
                          {copied ? t(M.gdrive.copied) : t(M.gdrive.copyLink)}
                        </button>
                        <input
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                          placeholder={t(M.gdrive.pastePlaceholder)}
                          className="w-full rounded bg-zinc-900 border border-zinc-850 px-2.5 py-2 text-xs text-white outline-none focus:border-an-green/50"
                        />
                        <button
                          disabled={!code.trim()}
                          onClick={() => {
                            send({ type: "googleAuthCode", code: code.trim() });
                            setCode("");
                          }}
                          className="w-full rounded-lg bg-an-green hover:bg-[var(--an-green-hover)] text-xs font-semibold py-2.5 text-black mt-1 active:scale-95 transition disabled:opacity-40"
                        >
                          {t(M.gdrive.confirm)}
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
              {t(M.custom.cancel)}
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
