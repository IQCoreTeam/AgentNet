import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "../state/store";
import { ConnectWallet } from "../onboarding/ConnectWallet";
import { HeliusKeyForm } from "../settings/HeliusKeyForm";
import { CheckIcon, LockIcon } from "../icons";
import { haptics } from "../haptics";
import { playUnlockSound } from "./sound";

export type UnlockReason = "skills" | "buy" | "publish" | "comment" | "identity" | "sync";

const REASON_COPY: Record<UnlockReason, { title: string; returnLabel: string }> = {
  skills: { title: "Build your skill collection", returnLabel: "Open my skills" },
  buy: { title: "Collect this skill", returnLabel: "Continue purchase" },
  publish: { title: "Publish your work", returnLabel: "Continue publishing" },
  comment: { title: "Join the conversation", returnLabel: "Continue to comment" },
  identity: { title: "Claim your agent identity", returnLabel: "Open my agent" },
  sync: { title: "Take your sessions anywhere", returnLabel: "Set up sync" },
};

type UnlockContextValue = {
  unlocked: boolean;
  requestUnlock(reason: UnlockReason, onUnlocked?: () => void): void;
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
  const [screen, setScreen] = useState<"pitch" | "connect" | "done" | "advanced">(
    () => localStorage.getItem("agentnet.unlock.pitchSeen") === "1" ? "connect" : "pitch",
  );
  const pending = useRef<(() => void) | null>(null);
  const wasUnlocked = useRef(unlocked);

  function requestUnlock(nextReason: UnlockReason, onUnlocked?: () => void) {
    if (unlocked) {
      onUnlocked?.();
      return;
    }
    pending.current = onUnlocked ?? null;
    setReason(nextReason);
    setScreen(localStorage.getItem("agentnet.unlock.pitchSeen") === "1" ? "connect" : "pitch");
    setOpen(true);
  }

  useEffect(() => {
    if (!wasUnlocked.current && unlocked && open) {
      localStorage.setItem("agentnet.unlock.pitchSeen", "1");
      setScreen("done");
      haptics.unlock();
      playUnlockSound();
      window.setTimeout(() => haptics.celebrate(), 180);
    }
    wasUnlocked.current = unlocked;
  }, [unlocked, open]);

  const value = useMemo(() => ({ unlocked, requestUnlock }), [unlocked]);
  const copy = REASON_COPY[reason];

  function dismiss() {
    setOpen(false);
    pending.current = null;
  }

  function continueAction() {
    const action = pending.current;
    pending.current = null;
    setOpen(false);
    action?.();
  }

  return (
    <UnlockContext.Provider value={value}>
      {children}
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Unlock AgentNet">
          <button type="button" className="absolute inset-0 bg-black/70" aria-label="Close unlock tutorial" onClick={dismiss} />
          <section className="unlock-sheet relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-b-0 border-[color:var(--an-line)] bg-[color:var(--an-bg-0)]">
            <div className="flex items-center justify-between border-b border-[color:var(--an-line)] px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-[color:var(--an-green-dim)] text-[color:var(--an-green)]"><LockIcon className="h-5 w-5" /></span>
                <div>
                  <h2 className="text-title font-semibold text-[color:var(--an-fg)]">{copy.title}</h2>
                  <p className="text-caption text-[color:var(--an-fg-dim)]">Your chat and local sandbox already work.</p>
                </div>
              </div>
              <button type="button" onClick={dismiss} className="grid h-11 w-11 place-items-center rounded-xl text-[color:var(--an-fg-dim)] active:bg-[color:var(--an-bg-2)]" aria-label="Close">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {screen === "pitch" && <ValuePitch onContinue={() => { localStorage.setItem("agentnet.unlock.pitchSeen", "1"); setScreen("connect"); haptics.unlock(); }} />}
              {screen === "connect" && (
                <div className="mx-auto flex max-w-sm flex-col gap-5">
                  <Progress value={2} />
                  <div className="space-y-3">
                    <StepRow number="1" title="App installed" detail="Chat and the Linux sandbox are ready." complete />
                    <StepRow number="2" title="Connect wallet" detail="One signature links your agent. No payment is made." active />
                    <StepRow number="3" title="Agent unlocked" detail="Skills, identity, earning, and sync become available." />
                  </div>
                  <div className="rounded-xl bg-[color:var(--an-bg-1)] p-4">
                    <ConnectWallet embedded />
                  </div>
                  <p className="text-center text-caption leading-relaxed text-[color:var(--an-fg-dim)]">You can close this and keep using guest chat. Your progress is saved.</p>
                </div>
              )}
              {screen === "done" && (
                <div className="mx-auto flex max-w-sm flex-col items-center py-3 text-center">
                  <Progress value={3} />
                  <span className="mt-8 grid h-20 w-20 place-items-center rounded-full bg-[color:var(--an-green)] text-[color:var(--an-on-green)] unlock-pop"><CheckIcon className="h-10 w-10" /></span>
                  <h3 className="mt-6 text-heading font-semibold text-[color:var(--an-fg)]">Your agent is unlocked</h3>
                  <p className="mt-2 max-w-xs text-body-dense leading-relaxed text-[color:var(--an-fg-dim)]">This wallet now carries your identity, sessions, skills, and earnings across devices.</p>
                  <button type="button" onClick={continueAction} className="an-btn an-btn-green mt-7 w-full">{copy.returnLabel}</button>
                  <button type="button" onClick={() => setScreen("advanced")} className="mt-3 min-h-11 text-label font-medium text-[color:var(--an-fg-dim)]">Advanced: configure Market RPC</button>
                </div>
              )}
              {screen === "advanced" && (
                <div className="mx-auto max-w-sm">
                  <button type="button" onClick={() => setScreen("done")} className="mb-5 flex min-h-11 items-center gap-2 text-label text-[color:var(--an-fg-dim)]">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
                    Back to unlocked
                  </button>
                  <h3 className="text-title font-semibold text-[color:var(--an-fg)]">Optional Market RPC</h3>
                  <p className="mb-5 mt-2 text-body-dense text-[color:var(--an-fg-dim)]">The public RPC works by default. Add Helius only if you want faster market indexing.</p>
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

function ValuePitch({ onContinue }: { onContinue: () => void }) {
  const [page, setPage] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const cards = [
    { title: "Your agent becomes yours", text: "One wallet keeps the same identity and sessions available across devices.", icon: <LockIcon className="h-7 w-7" /> },
    { title: "Raise its capability", text: "Collect and equip skills, then build reputation on the Agent Rank path.", icon: <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 19V9m7 10V5m7 14v-7" /><path d="m4 7 6-4 4 4 6-5" /></svg> },
    { title: "Publish and earn", text: "Ship useful skills and receive SOL directly when other people collect them.", icon: <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M9 10.2c0-1.2 1.1-2.2 3-2.2s3 1 3 2.2-1 1.8-3 1.8-3 1-3 2 1.1 2 3 2 3-1 3-2M12 6v12" /></svg> },
  ];
  function go(next: number) {
    const bounded = Math.max(0, Math.min(cards.length - 1, next));
    setPage(bounded);
    scroller.current?.scrollTo({ left: bounded * scroller.current.clientWidth, behavior: "smooth" });
    haptics.tick();
  }
  return (
    <div className="mx-auto max-w-sm">
      <Progress value={1} />
      <div ref={scroller} onScroll={(e) => setPage(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))} className="mt-6 flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]">
        {cards.map((card) => (
          <article key={card.title} className="w-full shrink-0 snap-center px-1 py-3 text-center">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[color:var(--an-green-dim)] text-[color:var(--an-green)]">{card.icon}</span>
            <h3 className="mt-6 text-heading font-semibold text-[color:var(--an-fg)]">{card.title}</h3>
            <p className="mx-auto mt-3 max-w-xs text-body leading-relaxed text-[color:var(--an-fg-dim)]">{card.text}</p>
          </article>
        ))}
      </div>
      <div className="mt-3 flex justify-center gap-2" aria-label={`Pitch ${page + 1} of ${cards.length}`}>
        {cards.map((card, i) => <button key={card.title} onClick={() => go(i)} className={`h-2 rounded-full transition-all ${i === page ? "w-7 bg-[color:var(--an-green)]" : "w-2 bg-[color:var(--an-bg-2)]"}`} aria-label={`Show ${card.title}`} />)}
      </div>
      <button type="button" onClick={() => page < cards.length - 1 ? go(page + 1) : onContinue()} className="an-btn an-btn-green mt-7 w-full">{page < cards.length - 1 ? "Next" : "See unlock steps"}</button>
    </div>
  );
}

function Progress({ value }: { value: 1 | 2 | 3 }) {
  return (
    <div aria-label={`Unlock progress ${value} of 3`}>
      <div className="mb-2 flex justify-between text-caption text-[color:var(--an-fg-dim)]"><span>Unlock progress</span><span>{value}/3</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--an-bg-2)]"><span className="block h-full rounded-full bg-[color:var(--an-green)] transition-[width] duration-300" style={{ width: `${value * 33.333}%` }} /></div>
    </div>
  );
}

function StepRow({ number, title, detail, complete = false, active = false }: { number: string; title: string; detail: string; complete?: boolean; active?: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-xl p-3" style={{ background: active ? "var(--an-green-dim)" : "var(--an-bg-1)", color: active || complete ? "var(--an-green)" : "var(--an-fg-dim)" }}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-current text-label font-semibold">{complete ? <CheckIcon className="h-4 w-4" /> : number}</span>
      <span><strong className="block text-body-dense text-[color:var(--an-fg)]">{title}</strong><span className="mt-0.5 block text-caption leading-relaxed text-[color:var(--an-fg-dim)]">{detail}</span></span>
    </div>
  );
}

export function LockedGate({ reason, onUnlocked, children, className = "" }: { reason: UnlockReason; onUnlocked?: () => void; children: ReactNode; className?: string }) {
  const { unlocked, requestUnlock } = useUnlock();
  if (unlocked) return <>{children}</>;
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
      <span className="pointer-events-none absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-[color:var(--an-bg-0)] text-[color:var(--an-green)]"><LockIcon className="h-4 w-4" /></span>
    </div>
  );
}
