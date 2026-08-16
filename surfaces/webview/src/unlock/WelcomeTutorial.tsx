import { useState } from "react";
import { useStore } from "../state/store";
import { FramedImage, SCANLINES } from "./UnlockProvider";
import { useT, type Msg } from "../i18n";
import { haptics } from "../haptics";
import coderImg from "../assets/welcome-coder.webp";
import syncImg from "../assets/welcome-sync.webp";
import earnImg from "../assets/welcome-earn.webp";

// Persisted once the user finishes the intro: connecting an engine (the only real ask) or
// explicitly opting out (Do not show again). Closing with [x] / Not now does NOT set it, so
// the intro returns next launch. The welcome never hands off to setup: Full Unlock is its own
// tutorial, opened from Settings or on demand, so this only introduces the app and the engine.
const SEEN_KEY = "agentnet.welcomeSeen";
function welcomeSeen(): boolean {
  return localStorage.getItem(SEEN_KEY) === "1";
}
function markWelcomeSeen(): void {
  localStorage.setItem(SEEN_KEY, "1");
}

type WelcomeCard = {
  // Terminal eyebrow above the frame; defaults to FIRST_BOOT for the pitch cards.
  eyebrow?: string;
  // The framed .webp; omitted on the engine-connect card (it has no art, just the ask).
  img?: string;
  position?: string;
  title: Msg;
  body: Msg;
  // Sits under the body, above the dots (a clause of the pitch).
  caption?: Msg;
  // Sits under the primary button (a reassurance footnote to the CTA).
  footnote?: Msg;
  // Advance-button label for a pitch card (defaults to "Next >").
  advanceLabel?: Msg;
  // Show the persistent "Do not show this again" opt-out under the advance button.
  optOut?: boolean;
  // The terminal card: render Connect claude / Connect codex / Not now instead of an advance.
  connect?: boolean;
};

// Copy is Msg data (en + ko); the component resolves it with t() at render, so the array stays
// a plain constant. Korean matches the approved "Onboarding Flow (Live)" design copy.
const CARDS: WelcomeCard[] = [
  {
    img: coderImg,
    position: "50% 30%",
    title: { en: "You are a developer now", ko: "이제부터 당신은 개발자입니다" },
    body: {
      en: "Your phone is now a computer with a genius developer friend inside. You can build anything. Ask that friend to do anything for you.",
      ko: "이제 이 폰은 천재 개발자 친구가 들어있는 컴퓨터예요. 무엇이든 만들 수 있어요. 당신이 그 친구에게 무엇이든 시켜봐요.",
    },
    footnote: { en: "No new account needed to start chatting.", ko: "채팅을 시작하는 데 새 계정은 필요 없어요." },
  },
  {
    img: syncImg,
    position: "50% 60%",
    title: { en: "Leave off here, pick up anywhere", ko: "여기서 멈추고, 어디서든 이어서" },
    body: {
      en: "Every chat session is encrypted and picks up on any device: your PC too, even over remote access.",
      ko: "모든 대화 세션이 암호화되어 어떤 기기에서든 이어서 할 수 있어요. PC에서도, 원격접속으로도요.",
    },
    footnote: {
      en: "All of this and more: just hit Full unlock in Settings later. Cloud backup and the PC install guide are covered there.",
      ko: "이런 것도 되니까, 나중에 설정에서 '풀 기능 언락'을 누르세요. 클라우드 백업부터 PC 설치 가이드까지 거기서 다 안내해요.",
    },
  },
  {
    img: earnImg,
    position: "50% 40%",
    title: { en: "Make prompts, earn money", ko: "당신이 프롬프트를 만들어서 돈을 버세요" },
    body: {
      en: "Skills teach your agent new tricks: making videos, trading, anything. Sell your best ones and get paid every time someone collects them.",
      ko: "스킬은 에이전트에게 새로운 재주를 가르칩니다. 영상 제작, 트레이딩, 무엇이든요. 최고의 스킬을 판매하고 누군가 수집할 때마다 수익을 받으세요.",
    },
    caption: { en: "Every skill is minted on-chain under your name.", ko: "모든 스킬은 당신의 이름으로 온체인에 민팅됩니다." },
    advanceLabel: { en: "OK", ko: "OK" },
    optOut: true,
    footnote: {
      en: "Setup can wait. When you want to do something, drop by the market and set up then.",
      ko: "설정은 나중에 해도 돼요. 하고 싶은 게 생기면 마켓에 들러서 그때 설정하세요.",
    },
  },
  {
    eyebrow: "GETTING_STARTED",
    title: { en: "Connect your coding engine", ko: "코딩 엔진을 연결하세요" },
    body: {
      en: "This is the only setup: connect claude or codex and you can start coding right away.",
      ko: "설정은 이거 딱 하나. claude나 codex 중 하나만 연결하면 바로 코딩을 시작할 수 있어요.",
    },
    connect: true,
  },
];

// First-boot greeting: a bottom-sheet CRT intro shown once to a brand-new (wallet-less) user
// who has landed in chat. It introduces the app over four cards and ends on the single real
// ask, connecting an engine. It never opens Full Unlock: that setup is a separate tutorial.
export function WelcomeTutorial() {
  const { state, selectEngine } = useStore();
  const t = useT();
  const [page, setPage] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const show = state.phase === "chat" && !state.walletAddress && !welcomeSeen() && !dismissed;
  if (!show) return null;

  const card = CARDS[page];

  // [x] / backdrop / Not now: close for THIS run only, so the intro reappears next launch.
  function closeForNow() {
    haptics.tap();
    setDismissed(true);
  }
  // Connecting an engine or "Do not show again": persist, so the intro never returns.
  function markDone() {
    markWelcomeSeen();
    setDismissed(true);
  }
  function next() {
    haptics.step1();
    setPage((p) => Math.min(CARDS.length - 1, p + 1));
  }
  // The one real ask: hand off to the engine sign-in. selectEngine routes to the claude/codex
  // auth surface (or straight to chat if it is already connected). Persist so the welcome does
  // not pop again after the sign-in round-trip. No wallet or Full Unlock is touched here.
  function connectEngine(cli: "claude" | "codex") {
    haptics.step1();
    markDone();
    selectEngine(cli);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Welcome to AgentNet">
      {/* Dimmed backdrop; tapping it closes for this run so the chat stays visible behind. */}
      <button type="button" className="absolute inset-0 bg-black/70" aria-label="Close welcome" onClick={closeForNow} />
      <section className="an-term-mono unlock-sheet relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden border border-b-0 border-[color:var(--an-line)] bg-[color:var(--an-bg-0)] text-[color:var(--an-fg)]">
        <div className="border-b border-[color:var(--an-line)]">
          <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--an-fg-mute)" }}>
            <span>&gt;WELCOME_SEQ 0{page + 1}/0{CARDS.length}</span><span>ようこそ ******</span>
          </div>
          <div className="mx-3 mb-3 flex items-center justify-between gap-2" style={{ backgroundColor: "var(--an-green)", backgroundImage: SCANLINES, color: "var(--an-on-green)", padding: "9px 12px" }}>
            <h2 className="truncate text-[13px] font-bold uppercase tracking-[0.14em]">{t({ en: "Welcome_Aboard", ko: "환영합니다" })}</h2>
            <button type="button" onClick={closeForNow} className="shrink-0 text-[13px] font-bold leading-none active:opacity-70" aria-label="Close">[x]</button>
          </div>
        </div>

        {/* key={page} remounts the content on each card swap so the framed image replays its
            short CRT flicker, matching the unlock pitch. */}
        <div key={page} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="mx-auto max-w-[320px] text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--an-green)]">&gt;{card.eyebrow ?? "FIRST_BOOT"}<span className="unlock-cursor">_</span></p>
            {card.img && <div className="mt-3"><FramedImage src={card.img} position={card.position} /></div>}
            <h3 className="mt-4 text-[19px] font-bold uppercase leading-[1.3] tracking-[0.08em] text-[color:var(--an-fg)]">{t(card.title)}</h3>
            <p className="mx-auto mt-2 max-w-[280px] text-[13px] leading-[1.65] text-[color:var(--an-fg-dim)]">{t(card.body)}</p>
            {card.caption && <p className="mx-auto mt-2 max-w-[280px] text-[11px] leading-[1.6] tracking-[0.04em] text-[color:var(--an-fg-mute)]">{t(card.caption)}</p>}

            <div className="mt-3 flex justify-center gap-1.5" aria-label={`Card ${page + 1} of ${CARDS.length}`}>
              {CARDS.map((_, i) => <span key={i} className={`welcome-dot ${i === page ? "on" : ""}`} />)}
            </div>

            {card.connect ? (
              <>
                <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--an-fg-mute)]">{t({ en: "Connect", ko: "연결" })}</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => connectEngine("claude")} className="an-btn an-btn-green flex-1">claude</button>
                  <button type="button" onClick={() => connectEngine("codex")} className="an-btn an-btn-green flex-1">codex</button>
                </div>
                <button type="button" onClick={closeForNow} className="an-btn an-btn-outline mt-2 w-full">{t({ en: "Not now", ko: "지금은 연결 안 할래요" })}</button>
              </>
            ) : (
              <>
                <button type="button" onClick={next} className="an-btn an-btn-green mt-3">{card.advanceLabel ? t(card.advanceLabel) : t({ en: "Next >", ko: "다음 >" })}</button>
                {card.optOut && (
                  <button type="button" onClick={markDone} className="welcome-ghost" style={{ minHeight: 30, color: "var(--an-fg-mute)", textDecoration: "underline", textUnderlineOffset: 3 }}>{t({ en: "Do not show this again", ko: "다시 보지 않기" })}</button>
                )}
              </>
            )}
            {card.footnote && <p className="mx-auto mt-2 max-w-[280px] text-[11px] text-[color:var(--an-fg-mute)]">{t(card.footnote)}</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
