import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useStore } from "../state/store";
import { HeliusKeyForm } from "../settings/HeliusKeyForm";
import { ConnectDriveForm } from "../settings/ConnectDriveForm";
import { CheckIcon, LockIcon } from "../icons";
import { useT, type Msg } from "../i18n";
import { haptics } from "../haptics";

export type UnlockReason = "skills" | "buy" | "publish" | "comment" | "identity" | "sync";

// The second tutorial: Full Unlock (setup). Opened from Settings or when an action needs it.
// The wallet is auto-created on open (device-local keypair, no signature), so the flow is just
// three optional steps: fund the wallet, back up to cloud, add a market RPC. `creating` is the
// brief auto-create wait before Fund. No pitch, no App_Installed, no signature connect step.
type UnlockScreen = "creating" | "fund" | "cloud" | "advanced" | "done";

// Beginner-friendly funding explainer (buy with a card, or transfer from an exchange). One
// source of truth, shared by the unlock Fund step and Settings > My Wallet.
export const FUND_GUIDE_URL = "https://help.phantom.com/hc/en-us/articles/50063625990931-Fund-your-Phantom-wallet";
type UnlockAction = (walletAddress: string) => void;

// CRT scanline overlay reused by the green terminal bars (title bar, Unlocked banner).
// Exported so the first-boot Welcome tutorial textures its title bar identically.
export const SCANLINES = "repeating-linear-gradient(0deg, rgba(0,0,0,0.11) 0, rgba(0,0,0,0.11) 1px, transparent 1px, transparent 4px)";

// Three steps: fund 01, cloud 02, rpc 03. `creating` is the pre-step wallet mint (no number).
const SEQ: Record<UnlockScreen, string> = { creating: "00", fund: "01", cloud: "02", advanced: "03", done: "03" };

const REASON_COPY: Record<UnlockReason, { title: Msg; returnLabel: Msg }> = {
  skills: { title: { en: "Build your skill collection", ko: "내 스킬 컬렉션 만들기" }, returnLabel: { en: "Open my skills", ko: "내 스킬 열기" } },
  buy: { title: { en: "Collect this skill", ko: "이 스킬 수집하기" }, returnLabel: { en: "Continue purchase", ko: "구매 계속하기" } },
  publish: { title: { en: "Publish your work", ko: "내 작업 게시하기" }, returnLabel: { en: "Continue publishing", ko: "게시 계속하기" } },
  comment: { title: { en: "Join the conversation", ko: "대화에 참여하기" }, returnLabel: { en: "Continue to comment", ko: "댓글 계속 작성" } },
  identity: { title: { en: "Claim your agent identity", ko: "에이전트 정체성 만들기" }, returnLabel: { en: "Open my agent", ko: "내 에이전트 열기" } },
  sync: { title: { en: "Take your sessions anywhere", ko: "세션을 어디서든 이어가기" }, returnLabel: { en: "Set up sync", ko: "동기화 설정" } },
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
  const { state, send } = useStore();
  const t = useT();
  const unlocked = !!state.walletAddress;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<UnlockReason>("identity");
  const [screen, setScreen] = useState<UnlockScreen>("creating");
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

  // Full Unlock. The wallet is created for the user (device-local keypair, no signature): with
  // no wallet yet, mint one and wait on `creating` until it lands, then the effect below advances
  // to Fund. If a wallet already exists, the gated action just proceeds (nothing to unlock).
  function requestUnlock(nextReason: UnlockReason, onUnlocked?: UnlockAction) {
    if (unlocked && state.walletAddress) {
      onUnlocked?.(state.walletAddress);
      return;
    }
    pending.current = onUnlocked ?? null;
    setReason(nextReason);
    setScreen("creating");
    setOpen(true);
    // Recommended path: a device-local keypair minted server-side. No wallet app, no signature.
    send({ type: "makeLocalWallet" });
  }

  useEffect(() => {
    if (!wasUnlocked.current && unlocked && open) {
      // Wallet just created → step 01 (Fund_Wallet), then the optional Cloud_Backup and Market
      // RPC before the Unlocked screen. Every step here is skippable.
      setScreen("fund");
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

  // Leaving mid-setup resets to the top so the ONLY thing that decides locked-vs-unlocked is the
  // wallet (state.walletAddress). No seen/read marker is persisted.
  function dismiss() {
    setOpen(false);
    pending.current = null;
    setScreen("creating");
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

  // Fund → optional Cloud_Backup → optional Market RPC → Unlocked. Post-wallet steps buzz light.
  function enterCloud() { setScreen("cloud"); haptics.tick(); }
  function enterAdvanced() { setScreen("advanced"); haptics.tick(); }
  // The single success moment: one celebrate buzz. Feedback is haptic only, no sound.
  function enterGranted() { setScreen("done"); haptics.celebrate(); }

  return (
    <UnlockContext.Provider value={value}>
      {children}
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="AgentNet Full Unlock">
          <button type="button" className="absolute inset-0 bg-black/70" aria-label="Close setup" onClick={unlocked ? continueAction : dismiss} />
          <section className="an-term-mono unlock-sheet relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden border border-b-0 border-[color:var(--an-line)] bg-[color:var(--an-bg-0)]">
            <div className="border-b border-[color:var(--an-line)]">
              <div className="an-term-mono flex items-center justify-between gap-2 px-4 pt-3 pb-2 text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--an-fg-mute)" }}>
                <span>&gt;UNLOCK_SEQ {SEQ[screen]}/03</span><span>アクセス {screen === "done" ? "OK" : "******"}</span>
              </div>
              <div className="mx-3 mb-3 flex items-center justify-between gap-2" style={{ backgroundColor: "var(--an-green)", backgroundImage: SCANLINES, color: "var(--an-on-green)", padding: "9px 12px" }}>
                <h2 className="an-term-mono truncate text-[13px] font-bold uppercase tracking-[0.14em]">{t({ en: "AgentNet Full Unlock", ko: "에이전트넷 풀 언락" })}</h2>
                <button type="button" onClick={unlocked ? continueAction : dismiss} className="an-term-mono shrink-0 text-[13px] font-bold leading-none active:opacity-70" aria-label="Close">[x]</button>
              </div>
            </div>

            {/* key={screen} remounts the content on each step swap so the icon replays its flicker. */}
            <div key={screen} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {screen === "creating" && <CreatingWallet />}
              {screen === "fund" && (
                <StepScreen step={1} title={t({ en: "Fund_Wallet", ko: "지갑_충전" })} status={t({ en: "Optional", ko: "선택사항" })} detail={t({ en: "Your wallet was created to encrypt every chat session and to buy and sell skills. There is no need to add funds now.", ko: "당신의 모든 대화 세션을 암호화하고, 스킬을 사고팔 수 있게 지갑을 만들었어요. 이 지갑을 기억해 두세요." })} icon={ICON_FUND}>
                  <FundControls address={state.walletAddress ?? ""} onDone={enterCloud} />
                </StepScreen>
              )}
              {screen === "cloud" && (
                <StepScreen step={2} title={t({ en: "Cloud_Backup", ko: "클라우드_백업" })} status={t({ en: "Needed_for_Sync", ko: "동기화_필수" })} detail={t({ en: "Back up encrypted sessions to your own Google Drive. This is what lets another device pick up your work. Your wallet key encrypts everything before upload; nobody else can read it.", ko: "암호화된 세션을 내 Google Drive에 백업합니다. 다른 기기가 작업을 이어받는 방법이에요. 업로드 전에 지갑 키로 모두 암호화되어 다른 누구도 읽을 수 없습니다." })} icon={ICON_CLOUD}>
                  <ConnectDriveForm onDone={enterAdvanced} skipLabel={t({ en: "Skip for now", ko: "지금은 건너뛰기" })} />
                  <p className="mt-3 text-center text-caption leading-relaxed text-[color:var(--an-fg-mute)]">{t({ en: "Sessions stay on this device until you connect. You can do this later in Settings.", ko: "연결 전까지 세션은 이 기기에만 저장됩니다. 나중에 설정에서 할 수 있어요." })}</p>
                </StepScreen>
              )}
              {screen === "advanced" && (
                <StepScreen step={3} title={t({ en: "Market_RPC", ko: "마켓_RPC" })} status={t({ en: "Optional_Module", ko: "선택_모듈" })} detail={t({ en: "Completely optional. The public RPC works by default. Paste a Helius key for faster market indexing.", ko: "완전 선택사항입니다. 기본은 퍼블릭 RPC로 그대로 동작해요. 더 빠른 마켓 인덱싱을 원하면 Helius 키를 붙여넣으세요." })} icon={ICON_RPC}>
                  <div className="mt-6"><HeliusKeyForm onDone={enterGranted} skipLabel={t({ en: "Skip for now", ko: "지금은 건너뛰기" })} /></div>
                </StepScreen>
              )}
              {screen === "done" && (
                <div className="mx-auto max-w-sm">
                  <Progress value={3} />
                  <div className="unlock-flicker an-term-mono mt-6 text-center text-[17px] font-extrabold uppercase tracking-[0.18em]" style={{ backgroundColor: "var(--an-green)", backgroundImage: SCANLINES, color: "var(--an-on-green)", padding: "12px 10px" }}>AgentNet Unlocked</div>
                  <div className="mt-5 flex flex-col gap-3">
                    {["Skills_Index", "Earning", "Comments", "Session_Sync"].map((label, i) => (
                      <div key={label} className="unlock-reward an-term-mono flex items-baseline gap-2 text-[11px] uppercase tracking-wide" style={{ color: "var(--an-green)", animationDelay: `${0.15 * (i + 1)}s` }}>
                        <span>+ {label}</span>
                        <span className="mb-[3px] flex-1 self-end border-b border-dotted" style={{ borderColor: "var(--an-fg-mute)" }} />
                        <span>[OK]</span>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={continueAction} className="an-btn an-btn-green mt-7 w-full">{t(copy.returnLabel)}</button>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </UnlockContext.Provider>
  );
}

// Step-box glyphs, matched to the tutorial design (coin · upload-to-cloud · rpc nodes).
const ICON_CLOUD = (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" aria-hidden="true"><path d="M4 16.5h16v4H4z" /><path d="M12 13.5V4.5" /><path d="M8.5 8 12 4.5 15.5 8" /></svg>
);
const ICON_RPC = (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" aria-hidden="true"><rect x="3.5" y="9.5" width="8" height="5" rx="2.5" /><rect x="12.5" y="9.5" width="8" height="5" rx="2.5" /><path d="M9 12h6" /></svg>
);
const ICON_FUND = (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 7.4v9.2" /><path d="M14.3 9.2c-.5-.7-1.4-1.1-2.3-1.1-1.4 0-2.4.8-2.4 1.9 0 2.5 4.9 1.3 4.9 3.8 0 1.1-1 1.9-2.5 1.9-1 0-1.9-.4-2.5-1.1" /></svg>
);

// Green corner-tick brackets, faked with eight thin gradient bars — the framed-screenshot look.
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

// The CRT-framed image (green corner brackets + scanline). Shared with the first-boot Welcome
// tutorial so both flows frame their imagery identically.
export function FramedImage({ src, position }: { src: string; position?: string }) {
  return (
    <div className="unlock-img-flicker relative mx-auto" style={{ width: 200, height: 132, border: "1px solid var(--an-green-line)" }}>
      <img src={src} alt="" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", objectPosition: position ?? "50% 50%", filter: "saturate(0.7)" }} />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0, rgba(0,0,0,0.22) 1px, transparent 1px, transparent 3px)" }} />
      <div style={IMAGE_BRACKETS} />
    </div>
  );
}

// A single external "> LABEL / sub · [↗]" terminal link row. One source of truth for the Fund
// step's funding link and the Welcome tutorial's VS Code / install-guide links.
export function LinkRow({ label, sub, href, className = "" }: { label: string; sub: string; href: string; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`flex items-center gap-2 border border-[color:var(--an-line)] px-3 py-2.5 text-left no-underline active:opacity-80 ${className}`}>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="an-term-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--an-green)]">&gt;{label}</span>
        <span className="truncate text-[11px] text-[color:var(--an-fg-dim)]">{sub}</span>
      </span>
      <span className="an-term-mono shrink-0 text-[11px] text-[color:var(--an-fg-mute)]">[↗]</span>
    </a>
  );
}

// The pre-step wait while the device-local keypair is minted server-side (no signature, no pay).
function CreatingWallet() {
  const t = useT();
  return (
    <div className="mx-auto max-w-sm py-8 text-center">
      <span className="an-term-mono mx-auto grid h-12 w-12 place-items-center border" style={{ borderColor: "var(--an-green)", background: "var(--an-green)", color: "var(--an-on-green)" }}>{ICON_FUND}</span>
      <p className="an-term-mono mt-4 text-[10px] uppercase tracking-[0.14em] text-[color:var(--an-fg-dim)]">&gt;CREATING_WALLET<span className="unlock-cursor">_</span></p>
      <h3 className="an-term-mono mt-1.5 text-[19px] font-bold uppercase tracking-[0.06em] text-[color:var(--an-fg)]">{t({ en: "Setting up", ko: "준비 중" })}</h3>
      <p className="mx-auto mt-2 max-w-xs text-body-dense leading-relaxed text-[color:var(--an-fg-dim)]">{t({ en: "Creating your wallet. No signature, no payment. This just takes a moment.", ko: "지갑을 만들고 있어요. 서명도, 결제도 없어요. 잠깐이면 됩니다." })}</p>
      <span className="mx-auto mt-6 block h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: "var(--an-green)", borderTopColor: "transparent" }} />
    </div>
  );
}

function Progress({ value }: { value: 1 | 2 | 3 }) {
  const t = useT();
  const on = value * 3; // 9 segments, 3 lit per completed step (3 steps)
  return (
    <div aria-label={`Unlock progress ${value} of 3`}>
      <div className="an-term-mono mb-1.5 flex justify-between text-[10px] uppercase tracking-[0.14em] text-[color:var(--an-fg-dim)]"><span>{t({ en: "Unlock_Progress", ko: "잠금해제_진행도" })}</span><span className="text-[color:var(--an-green)]">{value}/3</span></div>
      <div className="flex gap-[3px] border border-[color:var(--an-line)] p-1" style={{ background: "rgba(255,255,255,0.02)" }}>
        {Array.from({ length: 9 }).map((_, i) => (
          <span key={i} className="h-2.5 flex-1" style={{ background: i < on ? "var(--an-green)" : "var(--an-bg-2)" }} />
        ))}
      </div>
    </div>
  );
}

function StepScreen({ step, title, detail, status, icon, children }: { step: 1 | 2 | 3; title: string; detail: string; status?: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-sm">
      <Progress value={step} />
      <div className="mt-7 text-center">
        <span className="an-term-mono mx-auto grid h-12 w-12 place-items-center border text-[13px] font-bold" style={{ borderColor: "var(--an-green)", background: "var(--an-green)", color: "var(--an-on-green)" }}>{icon ?? "[OK]"}</span>
        <p className="an-term-mono mt-4 text-[10px] uppercase tracking-[0.14em] text-[color:var(--an-fg-dim)]">
          {status ? <>&gt;STEP_0{step}/03 · <span className="text-[color:var(--an-green)]">{status}</span></> : <>Step {step}/3</>}
        </p>
        <h3 className="an-term-mono mt-1.5 text-[19px] font-bold uppercase tracking-[0.06em] text-[color:var(--an-fg)]">{title}</h3>
        <p className="mx-auto mt-2 max-w-xs text-body-dense leading-relaxed text-[color:var(--an-fg-dim)]">{detail}</p>
      </div>
      {children}
    </div>
  );
}

// Fund_Wallet step body: shows the auto-created wallet address with a copy control and a
// beginner funding link. Deliberately low-pressure — both buttons just advance; nothing here
// blocks setup. The same address + FUND_GUIDE_URL surface again in Settings > My Wallet.
function FundControls({ address, onDone }: { address: string; onDone: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  async function copyAddress() {
    haptics.tap();
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = address;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="mt-6">
      <div className="relative border px-3 py-3 text-left" style={{ borderColor: "var(--an-green-line)", background: "var(--an-green-dim)" }}>
        <p className="an-term-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[color:var(--an-green)]">&gt;{t({ en: "YOUR_WALLET_ADDRESS", ko: "내_지갑_주소" })}</p>
        <button type="button" onClick={copyAddress} className="an-term-mono absolute right-2 top-2 border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] active:opacity-70" style={{ borderColor: "var(--an-line)", color: "var(--an-fg-mute)" }}>{copied ? t({ en: "[copied]", ko: "[복사됨]" }) : t({ en: "[copy]", ko: "[복사]" })}</button>
        <p className="an-term-mono mt-2 break-all pr-12 text-[12px] leading-relaxed" style={{ color: "var(--an-term-fg)" }}>{address}</p>
      </div>
      <p className="mt-2 text-left text-[10px] leading-relaxed text-[color:var(--an-fg-mute)]">{t({ en: "Also in the agent menu and Settings, any time.", ko: "에이전트 메뉴와 설정에서도 언제든 볼 수 있어요." })}</p>
      <LinkRow className="mt-3" label={t({ en: "HOW_TO_ADD_FUNDS", ko: "충전_방법" })} sub={t({ en: "Buy SOL and send it here · phantom guide", ko: "SOL 구매 · phantom 가이드" })} href={FUND_GUIDE_URL} />
      <button type="button" onClick={onDone} className="an-btn an-btn-green mt-4 w-full">OK</button>
      <button type="button" onClick={onDone} className="welcome-ghost mt-1">{t({ en: "I will fund later", ko: "나중에 충전할게요" })}</button>
      <p className="mx-auto mt-2 max-w-xs text-center text-caption leading-relaxed text-[color:var(--an-fg-mute)]">{t({ en: "Your wallet is always in the agent menu and Settings.", ko: "지갑은 언제나 에이전트 메뉴와 설정에 있어요." })}</p>
    </div>
  );
}

// `badge` draws the corner lock/check overlay — right for big card gates, but it collides
// with small inline buttons (Publish, the UNLOCK row), so those pass badge={false} and show
// their own inline lock instead.
export function LockedGate({ reason, onUnlocked, children, className = "", badge = true }: { reason: UnlockReason; onUnlocked?: UnlockAction; children: ReactNode; className?: string; badge?: boolean }) {
  const { unlocked, celebrating, requestUnlock } = useUnlock();
  const t = useT();
  if (unlocked && !celebrating) return <>{children}</>;
  if (unlocked) {
    return (
      <div className={`relative unlock-gate-reveal ${className}`} style={{ "--unlock-delay": `${REVEAL_DELAY[reason]}ms` } as CSSProperties}>
        {children}
        {/* v2 lock indicators: the corner tag flips to [OK] with a CRT flicker on reveal */}
        {badge && <span className="an-gate-tag an-gate-tag-ok unlock-flicker pointer-events-none"><CheckIcon className="h-[11px] w-[11px]" />[OK]</span>}
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
      aria-label={`${t({ en: "Locked", ko: "잠김" })}: ${t(REASON_COPY[reason].title)}`}
    >
      {/* v2 lock indicators: content dims to 50% AND desaturates behind a corner LOCKED tag */}
      <div className="pointer-events-none opacity-50" style={{ filter: "saturate(0.4)" }}>{children}</div>
      {badge && <span className="an-gate-tag pointer-events-none"><LockIcon className="h-[11px] w-[11px]" />LOCKED</span>}
    </div>
  );
}
