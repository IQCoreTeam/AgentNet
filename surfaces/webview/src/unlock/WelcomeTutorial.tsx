import { useState, type ReactNode } from "react";
import { useStore } from "../state/store";
import { useUnlock, FramedImage, LinkRow, SCANLINES } from "./UnlockProvider";
import { haptics } from "../haptics";
import coderImg from "../assets/welcome-coder.webp";
import syncImg from "../assets/welcome-sync.webp";
import earnImg from "../assets/welcome-earn.webp";

// Persisted only when the user finishes the intro (Start_Setup) or explicitly opts out
// (Do not show again). Closing with [x] / Explore first does NOT set it, so the intro
// returns next launch — matching the design's gating notes.
const SEEN_KEY = "agentnet.welcomeSeen";
function welcomeSeen(): boolean {
  return localStorage.getItem(SEEN_KEY) === "1";
}
function markWelcomeSeen(): void {
  localStorage.setItem(SEEN_KEY, "1");
}

type WelcomeCard = {
  img: string;
  position: string;
  title: ReactNode;
  body: string;
  // Sits under the body text, above the dots (a clause of the pitch — card 3).
  caption?: string;
  // Sits under the primary button (a reassurance footnote to the CTA — card 1).
  footnote?: string;
  links?: { label: string; sub: string; href: string }[];
};

const CARDS: WelcomeCard[] = [
  {
    img: coderImg,
    position: "50% 30%",
    title: <>Your phone just<br />learned to code</>,
    body: "Your phone is now a computer with a genius coder friend inside. You can build anything now.",
    footnote: "No new account needed to start chatting.",
  },
  {
    img: syncImg,
    position: "50% 60%",
    title: <>Leave off here,<br />pick up anywhere</>,
    body: "Start on your phone, continue on your laptop. Your work follows you, and only you can open it.",
    links: [
      { label: "VSCODE_EXTENSION", sub: "IQLabs.agentnet-vscode · marketplace", href: "https://marketplace.visualstudio.com/items?itemName=IQLabs.agentnet-vscode" },
      { label: "PC_INSTALL_GUIDE", sub: "VS Code / CLI install guide · github", href: "https://github.com/IQCoreTeam/AgentNet/tree/main/install-guide" },
    ],
  },
  {
    img: earnImg,
    position: "50% 40%",
    title: <>Good prompts are<br />worth money</>,
    body: "Skills teach your agent new tricks: making videos, trading, anything. Sell your best ones and get paid every time someone collects them.",
    caption: "Every skill is minted on-chain under your name.",
  },
];

// First-boot greeting: a full-screen CRT takeover shown once to a brand-new (wallet-less)
// user who has landed in chat. Start_Setup hands off to the unlock flow at step 01; a linked
// wallet is the single "setup done" signal, so this never returns once one exists.
export function WelcomeTutorial() {
  const { state } = useStore();
  const { requestUnlock } = useUnlock();
  const [page, setPage] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const show = state.phase === "chat" && !state.walletAddress && !welcomeSeen() && !dismissed;
  if (!show) return null;

  const card = CARDS[page];
  const last = page >= CARDS.length - 1;

  // [x] / Explore first: close for THIS run only → the intro reappears next launch.
  function closeForNow() {
    haptics.tap();
    setDismissed(true);
  }
  // Start_Setup / Do not show again: persist, so the intro never returns.
  function markDone() {
    markWelcomeSeen();
    setDismissed(true);
  }
  function startSetup() {
    haptics.step1();
    markDone();
    requestUnlock("skills", undefined, { skipIntro: true });
  }
  function next() {
    haptics.step1();
    setPage((p) => Math.min(CARDS.length - 1, p + 1));
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Welcome to AgentNet">
      {/* Dimmed backdrop; tapping it closes for this run (same as [x] / Explore first) so the
          chat stays visible behind rather than being fully covered by a takeover. */}
      <button type="button" className="absolute inset-0 bg-black/70" aria-label="Close welcome" onClick={closeForNow} />
      <section className="an-term-mono unlock-sheet relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden border border-b-0 border-[color:var(--an-line)] bg-[color:var(--an-bg-0)] text-[color:var(--an-fg)]">
        <div className="border-b border-[color:var(--an-line)]">
          <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--an-fg-mute)" }}>
            <span>&gt;WELCOME_SEQ 0{page + 1}/03</span><span>ようこそ ******</span>
          </div>
          <div className="mx-3 mb-3 flex items-center justify-between gap-2" style={{ backgroundColor: "var(--an-green)", backgroundImage: SCANLINES, color: "var(--an-on-green)", padding: "9px 12px" }}>
            <h2 className="truncate text-[13px] font-bold uppercase tracking-[0.14em]">Welcome_Aboard</h2>
            <button type="button" onClick={closeForNow} className="shrink-0 text-[13px] font-bold leading-none active:opacity-70" aria-label="Close">[x]</button>
          </div>
        </div>

        {/* key={page} remounts the content on each card swap so the framed image replays its
            short CRT flicker, matching the unlock pitch. */}
        <div key={page} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="mx-auto max-w-[320px] text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--an-green)]">&gt;FIRST_BOOT<span className="unlock-cursor">_</span></p>
            <div className="mt-3"><FramedImage src={card.img} position={card.position} /></div>
            <h3 className="mt-4 text-[19px] font-bold uppercase leading-[1.3] tracking-[0.08em] text-[color:var(--an-fg)]">{card.title}</h3>
            <p className="mx-auto mt-2 max-w-[280px] text-[13px] leading-[1.65] text-[color:var(--an-fg-dim)]">{card.body}</p>
            {card.caption && <p className="mx-auto mt-2 max-w-[280px] text-[11px] leading-[1.6] tracking-[0.04em] text-[color:var(--an-fg-mute)]">{card.caption}</p>}
            {card.links && (
              <div className="mt-3 flex flex-col gap-1.5 text-left">
                {card.links.map((l) => <LinkRow key={l.label} label={l.label} sub={l.sub} href={l.href} />)}
              </div>
            )}

            <div className="mt-3 flex justify-center gap-1.5" aria-label={`Card ${page + 1} of ${CARDS.length}`}>
              {CARDS.map((_, i) => <span key={i} className={`welcome-dot ${i === page ? "on" : ""}`} />)}
            </div>

            {last ? (
              <>
                <button type="button" onClick={startSetup} className="an-btn an-btn-green mt-3">Start_Setup &gt;</button>
                <button type="button" onClick={closeForNow} className="welcome-ghost mt-1">Explore first</button>
                <button type="button" onClick={markDone} className="welcome-ghost" style={{ minHeight: 30, color: "var(--an-fg-mute)", textDecoration: "underline", textUnderlineOffset: 3 }}>Do not show this again</button>
              </>
            ) : (
              <button type="button" onClick={next} className="an-btn an-btn-green mt-3">Next &gt;</button>
            )}
            {card.footnote && <p className="mx-auto mt-2 max-w-[280px] text-[11px] text-[color:var(--an-fg-mute)]">{card.footnote}</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
