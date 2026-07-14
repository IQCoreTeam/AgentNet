import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useStore } from "../state/store";
import { ConnectWallet } from "../onboarding/ConnectWallet";
import { HeliusKeyForm } from "../settings/HeliusKeyForm";
import { CheckIcon, LockIcon } from "../icons";
import { haptics } from "../haptics";
import { playUnlockSound } from "./sound";

export type UnlockReason = "skills" | "buy" | "publish" | "comment" | "identity" | "sync";
type UnlockScreen = "pitch" | "installed" | "connect" | "done" | "advanced";
type UnlockAction = (walletAddress: string) => void;

const PROGRESS_KEY = "agentnet.unlock.progress.v1";
const LEGACY_PITCH_KEY = "agentnet.unlock.pitchSeen";

// CRT scanline overlay reused by the green terminal bars (title bar, Access Granted banner).
const SCANLINES = "repeating-linear-gradient(0deg, rgba(0,0,0,0.11) 0, rgba(0,0,0,0.11) 1px, transparent 1px, transparent 4px)";
const SEQ: Record<UnlockScreen, string> = { pitch: "00", installed: "01", connect: "02", done: "03", advanced: "03" };

const REASON_COPY: Record<UnlockReason, { title: string; returnLabel: string }> = {
  skills: { title: "Build your skill collection", returnLabel: "Open my skills" },
  buy: { title: "Collect this skill", returnLabel: "Continue purchase" },
  publish: { title: "Publish your work", returnLabel: "Continue publishing" },
  comment: { title: "Join the conversation", returnLabel: "Continue to comment" },
  identity: { title: "Claim your agent identity", returnLabel: "Open my agent" },
  sync: { title: "Take your sessions anywhere", returnLabel: "Set up sync" },
};

const REVEAL_DELAY: Record<UnlockReason, number> = {
  identity: 0,
  skills: 90,
  buy: 180,
  publish: 270,
  comment: 360,
  sync: 450,
};

function savedProgress(): { screen: UnlockScreen; pitchPage: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "null") as { screen?: UnlockScreen; pitchPage?: number } | null;
    if (saved?.screen && ["pitch", "installed", "connect"].includes(saved.screen)) {
      return { screen: saved.screen, pitchPage: Math.max(0, Math.min(2, saved.pitchPage ?? 0)) };
    }
  } catch {
    // A malformed preference should never block the unlock action.
  }
  return localStorage.getItem(LEGACY_PITCH_KEY) === "1"
    ? { screen: "installed", pitchPage: 2 }
    : { screen: "pitch", pitchPage: 0 };
}

type UnlockContextValue = {
  unlocked: boolean;
  celebrating: boolean;
  requestUnlock(reason: UnlockReason, onUnlocked?: UnlockAction): void;
};

const UnlockContext = createContext<UnlockContextValue | null>(null);

export function useUnlock(): UnlockContextValue {
  const value = useContext(UnlockContext);
  if (!value) throw new Error("useUnlock must be used within UnlockProvider");
  return value;
}

export function UnlockProvider({ children }: { children: ReactNode }) {
  const { state } = useStore();
  const unlocked = !!state.walletAddress;
  const initial = useRef(savedProgress());
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<UnlockReason>("identity");
  const [screen, setScreen] = useState<UnlockScreen>(initial.current.screen);
  const [pitchPage, setPitchPage] = useState(initial.current.pitchPage);
  const [celebrating, setCelebrating] = useState(false);
  const pending = useRef<UnlockAction | null>(null);
  const wasUnlocked = useRef(unlocked);
  const timers = useRef<number[]>([]);
  const revealTimer = useRef<number | null>(null);

  function startBadgeReveal() {
    if (revealTimer.current !== null) window.clearTimeout(revealTimer.current);
    setCelebrating(true);
    revealTimer.current = window.setTimeout(() => {
      setCelebrating(false);
      revealTimer.current = null;
    }, 1150);
  }

  function requestUnlock(nextReason: UnlockReason, onUnlocked?: UnlockAction) {
    if (unlocked && state.walletAddress) {
      onUnlocked?.(state.walletAddress);
      return;
    }
    const saved = savedProgress();
    pending.current = onUnlocked ?? null;
    setReason(nextReason);
    setScreen(saved.screen);
    setPitchPage(saved.pitchPage);
    setOpen(true);
  }

  useEffect(() => {
    if (!open || unlocked || screen === "done" || screen === "advanced") return;
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({ screen, pitchPage }));
  }, [open, unlocked, screen, pitchPage]);

  useEffect(() => {
    if (!wasUnlocked.current && unlocked && open) {
      localStorage.removeItem(PROGRESS_KEY);
      localStorage.setItem(LEGACY_PITCH_KEY, "1");
      setScreen("done");
      haptics.unlock();
      playUnlockSound();
      timers.current.push(window.setTimeout(() => haptics.celebrate(), 180));
    }
    wasUnlocked.current = unlocked;
  }, [unlocked, open]);

  useEffect(() => () => {
    timers.current.forEach(window.clearTimeout);
    if (revealTimer.current !== null) window.clearTimeout(revealTimer.current);
  }, []);

  const value = useMemo(() => ({ unlocked, celebrating, requestUnlock }), [unlocked, celebrating, state.walletAddress]);
  const copy = REASON_COPY[reason];

  function dismiss() {
    setOpen(false);
    pending.current = null;
    if (unlocked) startBadgeReveal();
  }

  function continueAction() {
    const action = pending.current;
    pending.current = null;
    setOpen(false);
    startBadgeReveal();
    if (state.walletAddress && action) {
      const walletAddress = state.walletAddress;
      timers.current.push(window.setTimeout(() => action(walletAddress), 560));
    }
  }

  function go(next: UnlockScreen) {
    setScreen(next);
    // Escalating haptics as each tutorial step lands; the final unlock (screen "done") gets
    // the big unlock+celebrate buzz from the connect effect above, so it's not repeated here.
    if (next === "installed") haptics.step1();
    else if (next === "connect") haptics.step2();
    else haptics.tick();
    playUnlockSound();
  }

  return (
    <UnlockContext.Provider value={value}>
      {children}
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Unlock AgentNet">
          <button type="button" className="absolute inset-0 bg-black/70" aria-label="Close unlock tutorial" onClick={unlocked ? continueAction : dismiss} />
          <section className="unlock-sheet relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-b-0 border-[color:var(--an-line)] bg-[color:var(--an-bg-0)]">
            <div className="border-b border-[color:var(--an-line)]">
              <div className="an-term-mono flex items-center justify-between gap-2 px-4 pt-3 pb-2 text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--an-fg-mute)" }}>
                <span>&gt;UNLOCK_SEQ {SEQ[screen]}/03</span><span>アクセス ******</span>
              </div>
              <div className="mx-3 mb-3 flex items-center justify-between gap-2" style={{ backgroundColor: "var(--an-green)", backgroundImage: SCANLINES, color: "var(--an-on-green)", padding: "9px 12px" }}>
                <h2 className="an-term-mono truncate text-[13px] font-bold uppercase tracking-[0.14em]">{copy.title}</h2>
                <button type="button" onClick={unlocked ? continueAction : dismiss} className="an-term-mono shrink-0 text-[13px] font-bold leading-none active:opacity-70" aria-label="Close">[x]</button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {screen === "pitch" && (
                <ValuePitch
                  page={pitchPage}
                  onPageChange={setPitchPage}
                  onContinue={() => go("installed")}
                />
              )}
              {screen === "installed" && (
                <StepScreen step={1} title="App installed" detail="AgentNet, chat, local files, and the Linux sandbox are ready on this device." complete>
                  <button type="button" onClick={() => go("connect")} className="an-btn an-btn-green mt-7 w-full">Continue to wallet</button>
                </StepScreen>
              )}
              {screen === "connect" && (
                <StepScreen step={2} title="Connect wallet" detail="One signature links your agent. No payment is made.">
                  <div className="mt-6 rounded-xl bg-[color:var(--an-bg-1)] p-4"><ConnectWallet embedded /></div>
                  <p className="mt-4 text-center text-caption leading-relaxed text-[color:var(--an-fg-dim)]">Close this at any time. This step will be waiting when you return.</p>
                </StepScreen>
              )}
              {screen === "done" && (
                <div className="mx-auto max-w-sm">
                  <Progress value={3} />
                  <div className="unlock-flicker an-term-mono mt-6 text-center text-[17px] font-extrabold uppercase tracking-[0.18em]" style={{ backgroundColor: "var(--an-green)", backgroundImage: SCANLINES, color: "var(--an-on-green)", padding: "12px 10px" }}>Access Granted</div>
                  <div className="mt-5 flex flex-col gap-3">
                    {["Skills index", "Earning", "Comments", "Session sync"].map((label, i) => (
                      <div key={label} className="unlock-reward an-term-mono flex items-baseline gap-2 text-[11px] uppercase tracking-wide" style={{ color: "var(--an-green)", animationDelay: `${0.15 * (i + 1)}s` }}>
                        <span>+ {label}</span>
                        <span className="mb-[3px] flex-1 self-end border-b border-dotted" style={{ borderColor: "var(--an-fg-mute)" }} />
                        <span>[OK]</span>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={continueAction} className="an-btn an-btn-green mt-7 w-full">{copy.returnLabel}</button>
                  <button type="button" onClick={() => setScreen("advanced")} className="mt-3 min-h-11 w-full text-label font-medium text-[color:var(--an-fg-dim)]">Advanced: configure Market RPC</button>
                </div>
              )}
              {screen === "advanced" && (
                <div className="mx-auto max-w-sm">
                  <button type="button" onClick={() => setScreen("done")} className="mb-5 flex min-h-11 items-center gap-2 text-label text-[color:var(--an-fg-dim)]">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
                    Back to unlocked
                  </button>
                  <h3 className="text-title font-semibold text-[color:var(--an-fg)]">Optional Market RPC</h3>
                  <p className="mb-5 mt-2 text-body-dense text-[color:var(--an-fg-dim)]">The public RPC works by default. Add Helius only for faster market indexing.</p>
                  <HeliusKeyForm onDone={() => setScreen("done")} />
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </UnlockContext.Provider>
  );
}

function ValuePitch({ page, onPageChange, onContinue }: { page: number; onPageChange: (page: number) => void; onContinue: () => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const cards = [
    { title: "Your agent becomes yours", text: "One wallet keeps the same identity on every device and unlocks portable session sync.", icon: <LockIcon className="h-7 w-7" /> },
    { title: "Raise its capability", text: "Collect and equip skills, then build reputation on the Agent Rank path.", icon: <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 19V9m7 10V5m7 14v-7" /><path d="m4 7 6-4 4 4 6-5" /></svg> },
    { title: "Publish and earn", text: "Ship useful skills and receive SOL directly when other people collect them.", icon: <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M9 10.2c0-1.2 1.1-2.2 3-2.2s3 1 3 2.2-1 1.8-3 1.8-3 1-3 2 1.1 2 3 2 3-1 3-2M12 6v12" /></svg> },
  ];
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = page * el.clientWidth;
  }, []);
  function go(next: number) {
    const bounded = Math.max(0, Math.min(cards.length - 1, next));
    onPageChange(bounded);
    scroller.current?.scrollTo({ left: bounded * scroller.current.clientWidth, behavior: "smooth" });
    haptics.tick();
  }
  return (
    <div className="mx-auto max-w-sm">
      <p className="an-term-mono text-center text-[11px] font-bold uppercase tracking-[0.16em] text-[color:var(--an-green)]">&gt;WHY_UNLOCK<span className="unlock-cursor">_</span></p>
      <div ref={scroller} onScroll={(event) => onPageChange(Math.round(event.currentTarget.scrollLeft / Math.max(1, event.currentTarget.clientWidth)))} className="mt-3 flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]">
        {cards.map((card) => (
          <article key={card.title} className="w-full shrink-0 snap-center px-1 py-3 text-center">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[color:var(--an-green-dim)] text-[color:var(--an-green)]">{card.icon}</span>
            <h3 className="mt-6 text-heading font-semibold text-[color:var(--an-fg)]">{card.title}</h3>
            <p className="mx-auto mt-3 max-w-xs text-body leading-relaxed text-[color:var(--an-fg-dim)]">{card.text}</p>
          </article>
        ))}
      </div>
      <div className="mt-3 flex justify-center gap-2" aria-label={`Pitch ${page + 1} of ${cards.length}`}>
        {cards.map((card, index) => <button key={card.title} onClick={() => go(index)} className={`h-2 rounded-full transition-all ${index === page ? "w-7 bg-[color:var(--an-green)]" : "w-2 bg-[color:var(--an-bg-2)]"}`} aria-label={`Show ${card.title}`} />)}
      </div>
      <button type="button" onClick={() => page < cards.length - 1 ? go(page + 1) : onContinue()} className="an-btn an-btn-green mt-7 w-full">{page < cards.length - 1 ? "Next" : "Start unlock"}</button>
    </div>
  );
}

function Progress({ value }: { value: 1 | 2 | 3 }) {
  const on = value * 4; // 12 segments, 4 lit per completed step
  return (
    <div aria-label={`Unlock progress ${value} of 3`}>
      <div className="an-term-mono mb-1.5 flex justify-between text-[10px] uppercase tracking-[0.14em] text-[color:var(--an-fg-dim)]"><span>Unlock_Progress</span><span className="text-[color:var(--an-green)]">{value}/3</span></div>
      <div className="flex gap-[3px] border border-[color:var(--an-line)] p-1" style={{ background: "rgba(255,255,255,0.02)" }}>
        {Array.from({ length: 12 }).map((_, i) => (
          <span key={i} className="h-2.5 flex-1" style={{ background: i < on ? "var(--an-green)" : "var(--an-bg-2)" }} />
        ))}
      </div>
    </div>
  );
}

function StepScreen({ step, title, detail, complete = false, children }: { step: 1 | 2 | 3; title: string; detail: string; complete?: boolean; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-sm">
      <Progress value={step} />
      <div className="mt-7 text-center">
        <span className="an-term-mono mx-auto grid h-12 w-12 place-items-center border text-[13px] font-bold" style={complete ? { borderColor: "var(--an-green)", background: "var(--an-green)", color: "var(--an-on-green)" } : { borderColor: "var(--an-line)", color: "var(--an-fg-dim)" }}>{complete ? "[OK]" : step}</span>
        <p className="an-term-mono mt-4 text-[10px] uppercase tracking-[0.14em] text-[color:var(--an-fg-dim)]">Step {step}/3</p>
        <h3 className="an-term-mono mt-1.5 text-[19px] font-bold uppercase tracking-[0.06em] text-[color:var(--an-fg)]">{title}</h3>
        <p className="mx-auto mt-2 max-w-xs text-body-dense leading-relaxed text-[color:var(--an-fg-dim)]">{detail}</p>
      </div>
      {children}
    </div>
  );
}

// `badge` draws the corner lock/check overlay — right for big card gates, but it collides
// with small inline buttons (Publish, the UNLOCK row), so those pass badge={false} and show
// their own inline lock instead.
export function LockedGate({ reason, onUnlocked, children, className = "", badge = true }: { reason: UnlockReason; onUnlocked?: UnlockAction; children: ReactNode; className?: string; badge?: boolean }) {
  const { unlocked, celebrating, requestUnlock } = useUnlock();
  if (unlocked && !celebrating) return <>{children}</>;
  if (unlocked) {
    return (
      <div className={`relative unlock-gate-reveal ${className}`} style={{ "--unlock-delay": `${REVEAL_DELAY[reason]}ms` } as CSSProperties}>
        {children}
        {badge && <span className="pointer-events-none absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-[color:var(--an-green)] text-[color:var(--an-on-green)] unlock-badge-open"><CheckIcon className="h-4 w-4" /></span>}
      </div>
    );
  }
  return (
    <div
      className={`relative ${className}`}
      onClickCapture={(event) => { event.preventDefault(); event.stopPropagation(); requestUnlock(reason, onUnlocked); }}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); requestUnlock(reason, onUnlocked); } }}
      role="button"
      tabIndex={0}
      aria-label={`Locked: ${REASON_COPY[reason].title}`}
    >
      <div className="pointer-events-none opacity-55">{children}</div>
      {badge && <span className="pointer-events-none absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-[color:var(--an-bg-0)] text-[color:var(--an-green)]"><LockIcon className="h-4 w-4" /></span>}
    </div>
  );
}
