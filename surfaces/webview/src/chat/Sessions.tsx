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
      setMenuFor({ id: s.sessionId, title: s.title || t({ en: "(untitled)", ko: "(제목 없음)" }) });
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
                  label={t({ en: "My Agent", ko: "내 에이전트" })}
                  subtitle={t({ en: "Profile, skills, identity", ko: "프로필, 스킬, 아이덴티티" })}
                  onClick={onOpenAgent}
                  icon={<AgentIcon className="h-[22px] w-[22px]" />}
                />
              )}
              {state.walletAddress ? (
                <MenuRow
                  label={t({ en: "Settings", ko: "설정" })}
                  subtitle={t({ en: "Storage, RPC, GitHub, wallet", ko: "저장소, RPC, GitHub, 지갑" })}
                  onClick={() => setSettingsMode("configure")}
                  icon={settingsIcon}
                />
              ) : (
                // Not set up: Settings is greyed and locked behind a single Unlock_AgentNet
                // focus overlay, so the one first step is unmistakable. The plain row returns
                // once a wallet exists.
                <div className="relative">
                  <div style={{ opacity: 0.35, filter: "grayscale(1)", pointerEvents: "none" }} aria-hidden="true">
                    <MenuRow label={t({ en: "Settings", ko: "설정" })} subtitle={t({ en: "Storage, RPC, GitHub, wallet", ko: "저장소, RPC, GitHub, 지갑" })} onClick={() => {}} icon={settingsIcon} />
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
                  {t({ en: "Recents", ko: "최근 항목" })}
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
                    <span className="text-[0.78rem]" style={{ color: "var(--an-fg-dim)" }}>{t({ en: "Offline · showing saved chats", ko: "오프라인 · 저장된 채팅 표시" })}</span>
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
                        ? t({ en: "Cloud sync signed out · showing this device only · reconnect in Storage", ko: "클라우드 동기화 로그아웃됨 · 이 기기만 표시 · 저장소에서 재연결" })
                        : t({ en: "Cloud unreachable · showing this device only", ko: "클라우드 연결 불가 · 이 기기만 표시" })}
                    </span>
                  </div>
                )}
                {/* Offline with nothing cached: a minimal centered state, not an endless spinner. */}
                {!online && state.sessions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center" style={{ color: "var(--an-fg-mute)" }}>
                    <WifiOffIcon className="h-8 w-8" style={{ opacity: 0.6 }} />
                    <div>
                      <p className="text-[0.95rem]" style={{ color: "var(--an-fg-dim)" }}>{t({ en: "You're offline", ko: "오프라인 상태예요" })}</p>
                      <p className="mt-1 text-[0.75rem]">{t({ en: "Recent chats sync when you reconnect.", ko: "다시 연결되면 최근 채팅이 동기화돼요." })}</p>
                    </div>
                  </div>
                ) : online && !state.sessionsSynced ? (
                  <p className="flex items-center gap-2 px-2 py-5 text-[0.95rem]" style={{ color: "var(--an-fg-mute)" }}>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    {t({ en: "syncing…", ko: "동기화 중…" })}
                  </p>
                ) : online && state.sessionsSynced && state.sessions.length === 0 ? (
                  <p className="px-2 py-5 text-[0.95rem]" style={{ color: "var(--an-fg-mute)" }}>{t({ en: "No chats yet.", ko: "아직 채팅이 없어요." })}</p>
                ) : null}
                {state.sessions.map((s) => {
                  const active = s.sessionId === state.activeSessionId;
                  const running = state.sessionsRunning.includes(s.sessionId);
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
                      style={active ? ({ "--tk": "var(--an-term-fg-5)", "--bk": "transparent", "--ts": "8px" } as CSSProperties) : undefined}
                    >
                      <span className="an-term-mono min-w-0 flex-1 truncate text-[15px] font-bold" style={{ color: running ? "var(--an-run-fg)" : active ? "var(--an-term-fg)" : "var(--an-term-fg-2)" }}>
                        {s.title || t({ en: "(untitled)", ko: "(제목 없음)" })}
                      </span>
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
              {t({ en: "New chat", ko: "새 채팅" })}
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
                    {t({ en: "Delete chat", ko: "채팅 삭제" })}
                  </button>
                </div>
              </div>
            )}
          </>
        ) : settingsMode === "configure" ? (
          <div className="flex h-full flex-col">
            <div className="mb-3 flex items-center justify-between px-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t({ en: "Settings", ko: "설정" })}</span>
              {!settingsRoot && <button onClick={() => setSettingsMode("list")} className="text-xs text-zinc-400 hover:text-zinc-200">{t({ en: "Back", ko: "뒤로" })}</button>}
            </div>
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
              {onOpenSkills && (
                <ProgressiveMenuRow
                  reason="skills"
                  unlocked={!!state.walletAddress}
                  onUnlocked={onOpenSkills}
                  label={t({ en: "My Skills", ko: "내 스킬" })}
                  subtitle={state.walletAddress ? `${state.marketOwned.length} ${t({ en: "owned", ko: "개 보유" })}` : t({ en: "Connect a wallet to equip skills", ko: "스킬을 장착하려면 지갑 연결" })}
                  icon={<SkillIcon className="h-[22px] w-[22px]" />}
                />
              )}
              {state.walletAddress && (
                <MenuRow
                  label={t({ en: "My Wallet", ko: "내 지갑" })}
                  subtitle={`${state.walletAddress.slice(0, 4)}…${state.walletAddress.slice(-4)} · ${t({ en: "add funds", ko: "충전" })}`}
                  onClick={() => { setConfirmDisc(false); setSettingsMode("wallet"); }}
                  icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square"><path d="M4 7.5h15v12H4z" /><path d="M4 7.5V5.5h13v2" /><path d="M14 12.5h5v3h-5z" /></svg>}
                />
              )}
              <ProgressiveMenuRow
                reason="sync"
                unlocked={!!state.walletAddress}
                onUnlocked={() => setSettingsMode("connect")}
                label={t({ en: "Storage", ko: "저장소" })}
                subtitle={cloudConnected ? `${info?.account ?? (info?.kind === "gdrive" ? "Google Drive" : t({ en: "Custom Cloud", ko: "커스텀 클라우드" }))}${cloudSync ? ` · ${cloudSync.ok ? t({ en: "synced", ko: "동기화됨" }) : t({ en: "sync error", ko: "동기화 오류" })}` : ""}` : t({ en: "Local only", ko: "로컬 전용" })}
                icon={<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7.5c0-1.4 3.1-2.5 7-2.5s7 1.1 7 2.5S14.9 10 11 10 4 8.9 4 7.5Z" /><path d="M4 7.5v7c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-7" /><path d="M4 11c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" /></svg>}
              />
              {!state.walletAddress && (
                // Not set up: the wallet, cloud mirror, Market RPC, GitHub and AI Connections
                // rows collapse into one Set up entry, so a new user sees a single obvious next
                // step instead of a wall of locked rows. Buying a skill opens the same unlock.
                <MenuRow
                  accent
                  label={t({ en: "Set up AgentNet", ko: "에이전트넷 세팅하기" })}
                  subtitle={t({ en: "Wallet · cloud backup · market, one unlock", ko: "지갑 · 클라우드 백업 · 마켓, 한 번에 언락" })}
                  onClick={() => requestUnlock("identity")}
                  icon={<IqLogo className="h-[22px] w-[22px]" />}
                />
              )}
              {state.walletAddress && (<>
              <MenuRow
                label={t({ en: "Market RPC", ko: "마켓 RPC" })}
                subtitle={state.rpcStatus?.hasKey ? `${state.rpcStatus.network} · ${state.rpcStatus.masked}` : t({ en: "Helius key recommended", ko: "Helius 키 권장" })}
                onClick={() => setSettingsMode("helius")}
                icon={<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4v3M11 15v3M4 11h3M15 11h3" /><path d="m6.5 6.5 2.1 2.1M13.4 13.4l2.1 2.1M15.5 6.5l-2.1 2.1M8.6 13.4l-2.1 2.1" /><circle cx="11" cy="11" r="2.6" /></svg>}
              />
              <MenuRow
                label="GitHub"
                subtitle={state.githubStatus?.hasToken ? `${t({ en: "connected", ko: "연결됨" })} · ${state.githubStatus.masked ?? t({ en: "token set", ko: "토큰 설정됨" })}` : t({ en: "Private repo access", ko: "비공개 저장소 접근" })}
                onClick={() => { send({ type: "getGithubStatus" }); setSettingsMode("github"); }}
                icon={<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 16.5c-3 .9-3-1.5-4.2-1.8M15 19v-3.1c0-.8-.3-1.4-.8-1.8 2.6-.3 5.3-1.3 5.3-5.7 0-1.3-.4-2.3-1.2-3.2.1-.3.5-1.6-.1-3.1 0 0-1-.3-3.3 1.2a11.5 11.5 0 0 0-6 0C6.6 1.8 5.6 2.1 5.6 2.1c-.6 1.5-.2 2.8-.1 3.1-.8.9-1.2 2-1.2 3.2 0 4.4 2.7 5.4 5.3 5.7-.4.4-.7.9-.8 1.6V19" /></svg>}
              />
              <MenuRow
                label={t({ en: "AI Connections", ko: "AI 연결" })}
                subtitle={connectedEngines.length ? `${connectedEngines.join(" + ")} ${t({ en: "connected", ko: "연결됨" })}` : t({ en: "Not signed in", ko: "로그인 안 됨" })}
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
                      if (!v && state.typing) notify(t({ en: "Background off: task keeps running while the app is open.", ko: "백그라운드 꺼짐: 앱이 열려 있는 동안엔 작업이 계속 실행돼요." }));
                    }}
                    role="switch"
                    aria-checked={bgExec}
                    className="flex w-full items-center gap-3.5 rounded-2xl px-2.5 py-3 text-left transition active:bg-[color:var(--an-bg-2)]"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center" style={{ color: bgExec ? "var(--an-green)" : "var(--an-fg-dim)" }}>
                      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M11 7v4l2.5 2" /></svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="an-term-mono block text-[1.12rem] font-bold uppercase leading-tight" style={{ color: "var(--an-fg)" }}>{t({ en: "Background run", ko: "백그라운드 실행" })}</span>
                      <span className="block text-[0.72rem] leading-tight" style={{ color: "var(--an-fg-mute)" }}>{bgExec ? t({ en: "Runs in the background only while a task is active", ko: "작업이 진행 중일 때만 백그라운드에서 실행돼요" }) : t({ en: "Agent stops when you leave the app", ko: "앱을 나가면 에이전트가 멈춰요" })}</span>
                    </span>
                    <Toggle on={bgExec} />
                  </button>
                  {bgExec && (
                    <p className="px-2.5 pb-1 text-[0.68rem] leading-snug" style={{ color: "var(--an-fg-mute)" }}>
                      {t({ en: "Uses more battery while a task runs in the background. No task = nothing runs.", ko: "백그라운드에서 작업이 돌 때 배터리를 더 써요. 작업이 없으면 아무것도 안 돌아요." })}
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
                      <span className="an-term-mono block text-[1.12rem] font-bold uppercase leading-tight" style={{ color: "var(--an-fg)" }}>{t({ en: "Run while locked", ko: "잠금 상태에서 실행" })}</span>
                      <span className="block text-[0.72rem] leading-tight" style={{ color: "var(--an-fg-mute)" }}>
                        {!bgExec ? t({ en: "Turn on background execution first", ko: "먼저 백그라운드 실행을 켜세요" }) : screenOffExec ? t({ en: "Keeps active tasks running with the screen off", ko: "화면이 꺼져도 진행 중인 작업을 계속 실행해요" }) : t({ en: "Pauses may occur after the screen turns off", ko: "화면이 꺼진 뒤 멈출 수 있어요" })}
                      </span>
                    </span>
                    <Toggle on={screenOffExec} />
                  </button>
                  <p id="screen-off-exec-note" className="px-2.5 pb-1 text-[0.68rem] leading-snug" style={{ color: "var(--an-fg-mute)" }}>
                    {t({ en: "Uses more battery during active tasks. Approval requests and completed turns vibrate on the lock screen.", ko: "작업 중에는 배터리를 더 써요. 승인 요청과 완료된 턴은 잠금화면에서 진동으로 알려줘요." })}
                  </p>
                </>
              )}
              </>)}
              {/* Language lives outside the guest/setup split: a device preference, always shown. */}
              <MenuRow
                label={t({ en: "Language", ko: "언어" })}
                subtitle={LANGS.find((l) => l.code === lang)?.label ?? "English"}
                onClick={() => setSettingsMode("language")}
                icon={<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="M3 11h16" /><path d="M11 3c2.2 2.1 3.4 5 3.4 8s-1.2 5.9-3.4 8c-2.2-2.1-3.4-5-3.4-8s1.2-5.9 3.4-8Z" /></svg>}
              />
            </div>
            {state.walletAddress ? (
              // Non-destructive status only. Disconnect moved into My Wallet (a deliberate
              // destination) so it can't be fat-fingered from the panel's bottom edge.
              <div className="mt-2">
                <p className="an-sfcap">&gt;{t({ en: "CONNECTED", ko: "연결됨" })} · <span style={{ background: "var(--an-bg-2)", color: "var(--an-fg-dim)", padding: "2px 6px" }}>{`${state.walletAddress.slice(0, 4)}…${state.walletAddress.slice(-4)}`}</span> · <span style={{ color: "var(--an-green)" }}>{t({ en: "ONLINE", ko: "온라인" })}</span></p>
              </div>
            ) : (
              // Set up AgentNet now carries the unlock action as a menu row above, so the guest
              // footer is a calm status line, matching the connected case (no thumb-line CTA).
              <div className="mt-2">
                <p className="an-sfcap">&gt;{t({ en: "NOT_SET_UP", ko: "미설정" })} · <span style={{ background: "var(--an-bg-2)", color: "var(--an-fg-dim)", padding: "2px 6px" }}>GUEST</span><span className="unlock-cursor">_</span></p>
              </div>
            )}
          </div>
        ) : settingsMode === "wallet" ? (
          <div className="flex h-full flex-col">
            <SettingsSubHeader title={t({ en: "My Wallet", ko: "내 지갑" })} onBack={() => { setConfirmDisc(false); setSettingsMode("configure"); }} />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="relative border px-3 py-3" style={{ borderColor: "var(--an-green-line)", background: "var(--an-green-dim)" }}>
                <p className="an-term-mono text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: "var(--an-green)" }}>&gt;{t({ en: "YOUR_WALLET_ADDRESS", ko: "내_지갑_주소" })}</p>
                <button type="button" onClick={copyWalletAddress} className="an-term-mono absolute right-2 top-2 border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] active:opacity-70" style={{ borderColor: "var(--an-term-line-2)", color: "var(--an-fg-mute)" }}>{copied ? t({ en: "[copied]", ko: "[복사됨]" }) : t({ en: "[copy]", ko: "[복사]" })}</button>
                <p className="an-term-mono mt-2 break-all pr-12 text-[12px] leading-relaxed" style={{ color: "var(--an-term-fg)" }}>{state.walletAddress}</p>
              </div>
              <div className="mt-3 flex flex-col gap-2">
                <LinkRow label={t({ en: "ADD_FUNDS", ko: "충전하기" })} sub={t({ en: "Buy SOL and send it here · phantom guide", ko: "SOL을 구매해 이 주소로 전송 · phantom 가이드" })} href={FUND_GUIDE_URL} />
                <LinkRow label={t({ en: "VIEW_ON_EXPLORER", ko: "익스플로러에서_보기" })} sub={t({ en: "solscan.io/account · opens in browser", ko: "solscan.io/account · 브라우저에서 열림" })} href={`https://solscan.io/account/${state.walletAddress}`} />
              </div>
              <div className="an-term-mono mt-3 flex justify-between border-t pt-3 text-[10px] uppercase tracking-[0.08em]" style={{ borderColor: "var(--an-term-line)", color: "var(--an-fg-mute)" }}>
                <span>{t({ en: "Network", ko: "네트워크" })}</span><span style={{ color: "var(--an-term-fg-2)" }}>Solana Mainnet</span>
              </div>
            </div>
            {!confirmDisc ? (
              <button onClick={() => setConfirmDisc(true)} className="an-sfcta an-sfcta-disc mt-3">
                <span className="ico">
                  <svg width="20" height="20" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square"><path d="M8.5 4.5H4v13h4.5" /><path d="M14 15l3-4-3-4M17 11H8.5" /></svg>
                </span>
                <span className="grow">
                  <span className="ttl">{t({ en: "Disconnect_Wallet", ko: "지갑_연결해제" })}</span>
                  <span className="sub">{t({ en: "Clears the saved session on this device", ko: "이 기기에 저장된 세션을 지웁니다" })}</span>
                </span>
                <span className="xmk">[x]</span>
              </button>
            ) : (
              <div className="mt-3">
                <div className="border p-3" style={{ borderColor: "var(--an-red)", background: "rgba(229,72,77,0.08)" }}>
                  <p className="an-term-mono text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: "var(--an-red)" }}>&gt;{t({ en: "CONFIRM_DISCONNECT", ko: "연결해제_확인" })}</p>
                  <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--an-fg-dim)" }}>{t({ en: "Make sure you can recover this wallet first. This clears its key from this device, and there is no in-app backup. If you have not saved a way to restore it, you could lose access to this wallet and any funds in it.", ko: "먼저 이 지갑을 복구할 수 있는지 확인하세요. 이 기기에서 키가 지워지고, 앱 내 백업은 없어요. 복원할 방법을 저장해두지 않았다면 이 지갑과 그 안의 자금에 접근하지 못할 수 있어요." })}</p>
                </div>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => setConfirmDisc(false)} className="an-btn an-btn-outline flex-1">{t({ en: "Keep wallet", ko: "지갑 유지" })}</button>
                  <button
                    onClick={() => {
                      forgetAndroidWallet(); // clear the Keystore creds so we don't silently reconnect
                      send({ type: "disconnectWallet" });
                      onClose();
                    }}
                    className="an-btn an-btn-danger flex-1"
                  >
                    {t({ en: "Disconnect", ko: "연결해제" })}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : settingsMode === "helius" ? (
          <div className="flex flex-col h-full">
            <SettingsSubHeader title={t({ en: "Market RPC", ko: "마켓 RPC" })} onBack={() => setSettingsMode("configure")} />
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
            <SettingsSubHeader title={t({ en: "AI Connections", ko: "AI 연결" })} onBack={() => setSettingsMode("configure")} />
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
                        {connected ? t({ en: "Connected", ko: "연결됨" }) : t({ en: "Not signed in", ko: "로그인 안 됨" })}
                        {version?.installed ? ` · v${version.installed}` : ""}
                      </span>
                      {outdated && (
                        <span className="block text-[0.72rem] leading-tight" style={{ color: "var(--an-amber, #e90)" }}>
                          {updating ? t({ en: "Updating, this can take a minute", ko: "업데이트 중, 1분 정도 걸릴 수 있어요" }) : `v${version?.latest} ${t({ en: "available", ko: "사용 가능" })}`}
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
                        {updating ? t({ en: "Updating", ko: "업데이트 중" }) : t({ en: "Update", ko: "업데이트" })}
                      </button>
                    )}
                    {connected ? (
                      <button
                        onClick={() => send({ type: "logoutEngine", cli: c })}
                        className="an-term-mono shrink-0 text-[11px] font-bold uppercase tracking-wide transition active:opacity-70"
                        style={{ color: "var(--an-red, #e55)", border: "1px solid var(--an-line)", padding: "8px 12px" }}
                      >
                        {t({ en: "Log out", ko: "로그아웃" })}
                      </button>
                    ) : (
                      <button
                        onClick={() => selectEngine(c)}
                        className="an-term-mono shrink-0 text-[11px] font-bold uppercase tracking-wide transition active:opacity-70"
                        style={{ color: accent, border: `1px solid color-mix(in srgb, ${accent} 45%, var(--an-line))`, padding: "8px 12px" }}
                      >
                        {t({ en: "Connect", ko: "연결" })}
                      </button>
                    )}
                  </div>
                );
              })}
              <p className="px-2.5 pt-1 text-[0.68rem] leading-snug" style={{ color: "var(--an-fg-mute)" }}>
                {t({ en: "Connect opens that engine's sign-in. Signing out removes its credentials from this device; chat locks until an engine is connected again. Updates install straight from the official npm registry.", ko: "연결을 누르면 해당 엔진의 로그인이 열려요. 로그아웃하면 이 기기에서 자격 증명이 제거되고, 엔진을 다시 연결할 때까지 채팅이 잠깁니다. 업데이트는 공식 npm 레지스트리에서 바로 설치돼요." })}
              </p>
            </div>
          </div>
        ) : settingsMode === "language" ? (
          <div className="flex flex-col h-full">
            <SettingsSubHeader title={t({ en: "Language", ko: "언어" })} onBack={() => setSettingsMode(rootMode)} />
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
              {t({ en: "Defaults to your device language. Applies across onboarding and settings.", ko: "기본값은 기기 언어를 따라가요. 온보딩과 설정 전반에 적용됩니다." })}
            </p>
          </div>
        ) : settingsMode === "connect" ? (
          <div className="flex flex-col h-full justify-between">
            <div>
              <SettingsSubHeader title={t({ en: "Storage", ko: "저장소" })} onBack={() => setSettingsMode("configure")} />
              <div className="flex flex-col gap-2.5">
                {/* Radio picker: the filled dot = the active backend. Local = disconnect any
                    cloud; gdrive/custom open their existing connect flow. */}
                <StorageOption
                  active={!cloudConnected}
                  title={t({ en: "This device only", ko: "이 기기만" })}
                  subtitle={t({ en: "Sessions stay local. No cloud mirror.", ko: "세션이 로컬에만 저장됩니다. 클라우드 미러 없음." })}
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
                      ? `${t({ en: "Connected", ko: "연결됨" })}${info.account ? ` · ${info.account}` : ""}`
                      : t({ en: "Mirror sessions to your own Google account", ko: "내 Google 계정으로 세션 미러링" })
                  }
                  onClick={() => setSettingsMode("gdrive")}
                />
                <StorageOption
                  active={info?.kind === "custom" && !!info?.connected}
                  title={t({ en: "Custom Storage", ko: "커스텀 저장소" })}
                  subtitle={
                    info?.kind === "custom" && info?.connected
                      ? `${t({ en: "Connected", ko: "연결됨" })}${info.location ? ` · ${info.location}` : ""}`
                      : t({ en: "Mirror to an S3 / WebDAV / HTTP endpoint", ko: "S3 / WebDAV / HTTP 엔드포인트로 미러링" })
                  }
                  onClick={() => setSettingsMode("custom")}
                />
              </div>
            </div>
            <button
              onClick={() => setSettingsMode("configure")}
              className="w-full rounded-lg bg-zinc-800 hover:bg-zinc-700 py-2.5 text-xs text-zinc-200"
            >
              {t({ en: "Done", ko: "완료" })}
            </button>
          </div>
        ) : settingsMode === "custom" ? (
          <div className="flex flex-col h-full justify-between">
            <div>
              <SettingsSubHeader title={t({ en: "Custom Cloud", ko: "커스텀 클라우드" })} onBack={() => setSettingsMode("connect")} />
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-[10px] text-zinc-500 font-semibold uppercase block mb-1">
                    {t({ en: "Endpoint URL", ko: "엔드포인트 URL" })}
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
                    {t({ en: "Auth Header (optional)", ko: "인증 헤더 (선택)" })}
                  </label>
                  <input
                    value={customAuth}
                    onChange={(e) => setCustomAuth(e.target.value)}
                    placeholder={t({ en: "Bearer token...", ko: "Bearer 토큰..." })}
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
                  {t({ en: "Connect Storage", ko: "저장소 연결" })}
                </button>
              </div>
            </div>
            <button
              onClick={() => setSettingsMode("connect")}
              className="w-full rounded-lg bg-zinc-800 hover:bg-zinc-700 py-2.5 text-xs text-zinc-200"
            >
              {t({ en: "Cancel", ko: "취소" })}
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
                      {busy ? t({ en: "Starting Login…", ko: "로그인 시작 중…" }) : t({ en: "Sign in to Google Drive", ko: "Google Drive 로그인" })}
                    </button>
                    {googleLoginError && (
                      <p className="text-center text-[10px] text-red-400">{googleLoginError}</p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-[10px] text-zinc-400 leading-relaxed text-center">
                      {t({ en: "Google sign-in opened in your browser. Approve Drive access, then return to AgentNet.", ko: "브라우저에서 Google 로그인이 열렸어요. Drive 접근을 승인한 뒤 AgentNet으로 돌아오세요." })}
                    </p>
                    <button
                      onClick={() => openExternalUrl(googleLoginUrl)}
                      className="w-full rounded-lg bg-zinc-900 border border-zinc-850 hover:bg-zinc-800 text-[10px] font-medium py-2 text-zinc-300 active:scale-95 transition"
                    >
                      {t({ en: "Open Google Again", ko: "Google 다시 열기" })}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowManualCode((v) => !v)}
                      className="text-[10px] font-medium text-zinc-500 active:text-zinc-300"
                    >
                      {showManualCode ? t({ en: "Hide manual code entry", ko: "수동 코드 입력 숨기기" }) : t({ en: "Having trouble? Use code manually", ko: "문제가 있나요? 코드를 직접 입력하세요" })}
                    </button>
                    {showManualCode && (
                      <>
                        <a
                          href={googleLoginUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="break-all rounded-lg bg-zinc-900 px-2.5 py-2 text-[10px] leading-relaxed text-an-green border border-zinc-850 block text-center"
                        >
                          {t({ en: "Open Authorization URL", ko: "인증 URL 열기" })}
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
                          {copied ? t({ en: "Copied!", ko: "복사됨!" }) : t({ en: "Copy link", ko: "링크 복사" })}
                        </button>
                        <input
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                          placeholder={t({ en: "Paste URL or code here", ko: "URL이나 코드를 붙여넣으세요" })}
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
                          {t({ en: "Confirm", ko: "확인" })}
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
              {t({ en: "Cancel", ko: "취소" })}
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
