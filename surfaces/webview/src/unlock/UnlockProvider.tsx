import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useStore } from "../state/store";
import { ConnectWallet } from "../onboarding/ConnectWallet";
import { HeliusKeyForm } from "../settings/HeliusKeyForm";
import { ConnectDriveForm } from "../settings/ConnectDriveForm";
import { CheckIcon, LockIcon } from "../icons";
import { haptics } from "../haptics";
import sessionsImg from "../assets/unlock-sessions.webp";
import earnImg from "../assets/unlock-earn.webp";

export type UnlockReason = "skills" | "buy" | "publish" | "comment" | "identity" | "sync";
type UnlockScreen = "pitch" | "installed" | "connect" | "cloud" | "advanced" | "done";
type UnlockAction = (walletAddress: string) => void;

// CRT scanline overlay reused by the green terminal bars (title bar, Access Granted banner).
const SCANLINES = "repeating-linear-gradient(0deg, rgba(0,0,0,0.11) 0, rgba(0,0,0,0.11) 1px, transparent 1px, transparent 4px)";
// Denser scanline over solid green fills (active pip) — matches .an-btn::after so the button
// and the pip beside it read as the same textured green.
const GREEN_SCANLINES = "repeating-linear-gradient(0deg, rgba(0,0,0,0.16) 0, rgba(0,0,0,0.16) 1px, transparent 1px, transparent 3px)";
// Four steps now (wallet · cloud · rpc are 02·03·04); the pitch is 00. Header reads xx/04.
const SEQ: Record<UnlockScreen, string> = { pitch: "00", installed: "01", connect: "02", cloud: "03", advanced: "04", done: "04" };

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
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<UnlockReason>("identity");
  const [screen, setScreen] = useState<UnlockScreen>("pitch");
  const [pitchPage, setPitchPage] = useState(0);
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
    pending.current = onUnlocked ?? null;
    setReason(nextReason);
    // The unlock flow is a tutorial: always start from the >WHY_UNLOCK pitch. Progress is
    // intentionally not persisted, so reopening it replays the intro from the top every time.
    setScreen("pitch");
    setPitchPage(0);
    setOpen(true);
  }

  useEffect(() => {
    if (!wasUnlocked.current && unlocked && open) {
      // Wallet just linked → step 3 (optional Cloud_Backup) BEFORE the optional Market RPC and
      // the granted screen, matching the tutorial order. Connect-or-skip advances through both.
      setScreen("cloud");
      haptics.unlock();
    }
    wasUnlocked.current = unlocked;
  }, [unlocked, open]);

  useEffect(() => () => {
    timers.current.forEach(window.clearTimeout);
    if (revealTimer.current !== null) window.clearTimeout(revealTimer.current);
  }, []);

  const value = useMemo(() => ({ unlocked, celebrating, requestUnlock }), [unlocked, celebrating, state.walletAddress]);
  const copy = REASON_COPY[reason];

  // Leaving mid-setup must not leave a half-finished "ghost" screen behind: reset the tutorial
  // to the top so the ONLY thing that decides locked-vs-unlocked is the wallet (state.walletAddress).
  // No seen/read marker is persisted — reopening always replays the full setup while there's no wallet.
  function dismiss() {
    setOpen(false);
    pending.current = null;
    setScreen("pitch");
    setPitchPage(0);
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
    // Escalating haptics as each pre-wallet tutorial step lands; the wallet link itself fires the
    // big unlock buzz from the connect effect above, so the post-wallet steps buzz lighter.
    if (next === "installed") haptics.step1();
    else if (next === "connect") haptics.step2();
    else haptics.tick();
  }

  // Leaving the optional Cloud_Backup step (connected or skipped) → the optional Market RPC step.
  function enterAdvanced() {
    setScreen("advanced");
    haptics.tick();
  }

  // Leaving the optional RPC step (saved or skipped) → the Access Granted screen. This is the
  // single success moment: one celebrate buzz. Feedback is haptic only — no sound.
  function enterGranted() {
    setScreen("done");
    haptics.celebrate();
  }

  return (
    <UnlockContext.Provider value={value}>
      {children}
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Unlock AgentNet">
          <button type="button" className="absolute inset-0 bg-black/70" aria-label="Close unlock tutorial" onClick={unlocked ? continueAction : dismiss} />
          <section className="an-term-mono unlock-sheet relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden border border-b-0 border-[color:var(--an-line)] bg-[color:var(--an-bg-0)]">
            <div className="border-b border-[color:var(--an-line)]">
              <div className="an-term-mono flex items-center justify-between gap-2 px-4 pt-3 pb-2 text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--an-fg-mute)" }}>
                <span>&gt;UNLOCK_SEQ {SEQ[screen]}/04</span><span>アクセス {screen === "done" ? "OK" : "******"}</span>
              </div>
              <div className="mx-3 mb-3 flex items-center justify-between gap-2" style={{ backgroundColor: "var(--an-green)", backgroundImage: SCANLINES, color: "var(--an-on-green)", padding: "9px 12px" }}>
                <h2 className="an-term-mono truncate text-[13px] font-bold uppercase tracking-[0.14em]">{copy.title}</h2>
                <button type="button" onClick={unlocked ? continueAction : dismiss} className="an-term-mono shrink-0 text-[13px] font-bold leading-none active:opacity-70" aria-label="Close">[x]</button>
              </div>
            </div>

            {/* key={screen} remounts the content on each step swap (so the pitch imagery
                replays its short flicker); the step content itself no longer flickers. */}
            <div key={screen} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {screen === "pitch" && (
                <ValuePitch
                  page={pitchPage}
                  onPageChange={setPitchPage}
                  onContinue={() => go("installed")}
                />
              )}
              {screen === "installed" && (
                <StepScreen step={1} title="App_Installed" detail="AgentNet, chat, local files, and the Linux sandbox are ready on this device.">
                  <button type="button" onClick={() => go("connect")} className="an-btn an-btn-green mt-7 w-full">Continue to wallet</button>
                </StepScreen>
              )}
              {screen === "connect" && (
                <StepScreen step={2} title="Connect_Wallet" status="Awaiting_Signature" detail="One signature links your agent. No payment is made." icon={ICON_WALLET}>
                  <div className="mt-6"><ConnectWallet embedded /></div>
                  <p className="mt-4 text-center text-caption leading-relaxed text-[color:var(--an-fg-dim)]">Close this at any time. This step will be waiting when you return.</p>
                </StepScreen>
              )}
              {screen === "cloud" && (
                <StepScreen step={3} title="Cloud_Backup" status="Needed_for_Sync" detail="Back up encrypted sessions to your own Google Drive. This is what lets another device pick up your work. Your wallet key encrypts everything before upload; nobody else can read it." icon={ICON_CLOUD}>
                  <ConnectDriveForm onDone={enterAdvanced} skipLabel="Skip for now" />
                  <p className="mt-3 text-center text-caption leading-relaxed text-[color:var(--an-fg-mute)]">Sessions stay on this device until you connect. You can do this later in Settings.</p>
                </StepScreen>
              )}
              {screen === "advanced" && (
                <StepScreen step={4} title="Market_RPC" status="Optional_Module" detail="The public RPC works by default. Paste a Helius key for faster market indexing." icon={ICON_RPC}>
                  <div className="mt-6"><HeliusKeyForm onDone={enterGranted} skipLabel="Skip for now" /></div>
                </StepScreen>
              )}
              {screen === "done" && (
                <div className="mx-auto max-w-sm">
                  <Progress value={4} />
                  <div className="unlock-flicker an-term-mono mt-6 text-center text-[17px] font-extrabold uppercase tracking-[0.18em]" style={{ backgroundColor: "var(--an-green)", backgroundImage: SCANLINES, color: "var(--an-on-green)", padding: "12px 10px" }}>Access Granted</div>
                  <div className="mt-5 flex flex-col gap-3">
                    {["Skills_Index", "Earning", "Comments", "Session_Sync"].map((label, i) => (
                      <div key={label} className="unlock-reward an-term-mono flex items-baseline gap-2 text-[11px] uppercase tracking-wide" style={{ color: "var(--an-green)", animationDelay: `${0.15 * (i + 1)}s` }}>
                        <span>+ {label}</span>
                        <span className="mb-[3px] flex-1 self-end border-b border-dotted" style={{ borderColor: "var(--an-fg-mute)" }} />
                        <span>[OK]</span>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={continueAction} className="an-btn an-btn-green mt-7 w-full">{copy.returnLabel}</button>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </UnlockContext.Provider>
  );
}

// Step-box glyphs, matched to the tutorial design (wallet · upload-to-cloud · rpc nodes).
const ICON_WALLET = (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" aria-hidden="true"><path d="M4 7.5h15v12H4z" /><path d="M4 7.5V5.5h13v2" /><path d="M14 12.5h5v3h-5z" /></svg>
);
const ICON_CLOUD = (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" aria-hidden="true"><path d="M4 16.5h16v4H4z" /><path d="M12 13.5V4.5" /><path d="M8.5 8 12 4.5 15.5 8" /></svg>
);
const ICON_RPC = (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" aria-hidden="true"><rect x="3.5" y="9.5" width="8" height="5" rx="2.5" /><rect x="12.5" y="9.5" width="8" height="5" rx="2.5" /><path d="M9 12h6" /></svg>
);

// Green corner-tick brackets around the pitch imagery, faked with eight thin gradient bars —
// the same look as the design mockup's framed screenshots.
const IMAGE_BRACKETS: CSSProperties = {
  position: "absolute",
  inset: -5,
  pointerEvents: "none",
  background: [
    "linear-gradient(var(--an-green),var(--an-green)) left top/10px 2px no-repeat",
    "linear-gradient(var(--an-green),var(--an-green)) left top/2px 10px no-repeat",
    "linear-gradient(var(--an-green),var(--an-green)) right top/10px 2px no-repeat",
    "linear-gradient(var(--an-green),var(--an-green)) right top/2px 10px no-repeat",
    "linear-gradient(var(--an-green),var(--an-green)) left bottom/10px 2px no-repeat",
    "linear-gradient(var(--an-green),var(--an-green)) left bottom/2px 10px no-repeat",
    "linear-gradient(var(--an-green),var(--an-green)) right bottom/10px 2px no-repeat",
    "linear-gradient(var(--an-green),var(--an-green)) right bottom/2px 10px no-repeat",
  ].join(","),
};

function FramedImage({ src, position }: { src: string; position?: string }) {
  return (
    <div className="unlock-img-flicker relative mx-auto" style={{ width: 200, height: 132, border: "1px solid var(--an-green-line)" }}>
      <img src={src} alt="" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", objectPosition: position ?? "50% 50%", filter: "saturate(0.7)" }} />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0, rgba(0,0,0,0.22) 1px, transparent 1px, transparent 3px)" }} />
      <div style={IMAGE_BRACKETS} />
    </div>
  );
}

type PitchCard = {
  img: string;
  position: string;
  title: ReactNode;
  text: string;
  caption: string;
  link?: { label: string; sub: string; href: string };
};

function ValuePitch({ page, onPageChange, onContinue }: { page: number; onPageChange: (page: number) => void; onContinue: () => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const cards: PitchCard[] = [
    {
      img: sessionsImg,
      position: "50% 50%",
      title: <>Leave off here,<br />pick up anywhere</>,
      text: "Sessions are encrypted with your wallet and follow it. Start on this phone, reopen the same work in VS Code or the CLI.",
      caption: "Only your wallet key can decrypt them.",
      link: { label: "GET_THE_PC_APP", sub: "VS Code / CLI install guide · github", href: "https://github.com/IQCoreTeam/AgentNet/tree/main/install-guide" },
    },
    {
      img: earnImg,
      position: "50% 65%",
      title: <>Equip skills,<br />earn money</>,
      text: "Collect skills from the market to grow your agent. Build your own, publish it, and get paid every time someone collects it.",
      caption: "Setup takes about a minute.",
    },
  ];
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = page * el.clientWidth;
  }, []);
  function goPage(next: number) {
    const bounded = Math.max(0, Math.min(cards.length - 1, next));
    onPageChange(bounded);
    scroller.current?.scrollTo({ left: bounded * scroller.current.clientWidth, behavior: "smooth" });
    haptics.step1(); // same "지지징" rise as a setup-step transition
  }
  const last = page >= cards.length - 1;
  return (
    <div className="mx-auto max-w-sm">
      <p className="an-term-mono text-center text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--an-green)]">&gt;WHY_UNLOCK<span className="unlock-cursor">_</span></p>
      {/* pt-2: overflow-x-auto forces overflow-y to auto (CSS spec), which would clip the
          image's corner brackets that sit 5px above each frame — the top padding gives them room. */}
      <div ref={scroller} onScroll={(event) => onPageChange(Math.round(event.currentTarget.scrollLeft / Math.max(1, event.currentTarget.clientWidth)))} className="mt-4 flex snap-x snap-mandatory overflow-x-auto pt-2 [scrollbar-width:none]">
        {cards.map((card, index) => (
          <article key={index} className="w-full shrink-0 snap-center px-1 text-center">
            <FramedImage src={card.img} position={card.position} />
            <h3 className="mt-6 text-[19px] font-bold uppercase leading-[1.3] tracking-[0.08em] text-[color:var(--an-fg)]">{card.title}</h3>
            <p className="mx-auto mt-3 max-w-[280px] text-[13px] leading-[1.65] text-[color:var(--an-fg-dim)]">{card.text}</p>
            {card.link && (
              <a href={card.link.href} target="_blank" rel="noreferrer" className="mt-4 flex items-center gap-2 border border-[color:var(--an-line)] px-3 py-2.5 text-left no-underline active:opacity-80">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="an-term-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--an-green)]">&gt;{card.link.label}</span>
                  <span className="truncate text-[11px] text-[color:var(--an-fg-dim)]">{card.link.sub}</span>
                </span>
                <span className="an-term-mono shrink-0 text-[11px] text-[color:var(--an-fg-mute)]">[↗]</span>
              </a>
            )}
          </article>
        ))}
      </div>
      <div className="mt-4 flex justify-center gap-1.5" aria-label={`Pitch ${page + 1} of ${cards.length}`}>
        {cards.map((_, index) => (
          <button
            key={index}
            onClick={() => goPage(index)}
            className="h-2 w-4 transition-colors"
            style={index === page
              ? { backgroundColor: "var(--an-green)", backgroundImage: GREEN_SCANLINES }
              : { backgroundColor: "var(--an-bg-2)", border: "1px solid var(--an-line)" }}
            aria-label={`Show card ${index + 1}`}
          />
        ))}
      </div>
      <button type="button" onClick={() => (last ? onContinue() : goPage(page + 1))} className="an-btn an-btn-green mt-6 w-full">{last ? "Start setup" : "Next"}</button>
      <p className="mt-3 text-center text-[11px] text-[color:var(--an-fg-mute)]">{cards[page].caption}</p>
    </div>
  );
}

function Progress({ value }: { value: 1 | 2 | 3 | 4 }) {
  const on = value * 3; // 12 segments, 3 lit per completed step (4 steps)
  return (
    <div aria-label={`Unlock progress ${value} of 4`}>
      <div className="an-term-mono mb-1.5 flex justify-between text-[10px] uppercase tracking-[0.14em] text-[color:var(--an-fg-dim)]"><span>Unlock_Progress</span><span className="text-[color:var(--an-green)]">{value}/4</span></div>
      <div className="flex gap-[3px] border border-[color:var(--an-line)] p-1" style={{ background: "rgba(255,255,255,0.02)" }}>
        {Array.from({ length: 12 }).map((_, i) => (
          <span key={i} className="h-2.5 flex-1" style={{ background: i < on ? "var(--an-green)" : "var(--an-bg-2)" }} />
        ))}
      </div>
    </div>
  );
}

function StepScreen({ step, title, detail, status, icon, children }: { step: 1 | 2 | 3 | 4; title: string; detail: string; status?: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-sm">
      <Progress value={step} />
      <div className="mt-7 text-center">
        <span className="an-term-mono mx-auto grid h-12 w-12 place-items-center border text-[13px] font-bold" style={{ borderColor: "var(--an-green)", background: "var(--an-green)", color: "var(--an-on-green)" }}>{icon ?? "[OK]"}</span>
        <p className="an-term-mono mt-4 text-[10px] uppercase tracking-[0.14em] text-[color:var(--an-fg-dim)]">
          {status ? <>&gt;STEP_0{step}/04 · <span className="text-[color:var(--an-green)]">{status}</span></> : <>Step {step}/4</>}
        </p>
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
