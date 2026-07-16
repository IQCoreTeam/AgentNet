import { useMemo } from "react";
import type { SkillCard } from "../transport/protocol";
import { skillSigilSvg } from "./skillSigil";

// The buy-success receipt (design "Popup · Skill purchased"): a green-framed terminal panel
// that boots in with the CRT flicker (like Access Denied), showing the ACTUAL bought skill —
// its sigil art, name, the SOL paid, and the on-chain mint address. Presentational only: the
// caller (CompleteCelebration) owns the haptic + auto-dismiss timing. buyResult carries no tx
// signature, so the mint (card.id) is the honest on-chain reference shown.
const SCANLINES = "repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0, rgba(0,0,0,0.22) 1px, transparent 1px, transparent 3px)";

export function SkillReceiptOverlay({ card, onClick }: { card: SkillCard; onClick?: () => void }) {
  const sigil = useMemo(() => skillSigilSvg(card.name, card.category), [card.name, card.category]);
  const paid = card.price && card.price !== "0" ? `${(Number(card.price) / 1e9).toFixed(2)} ◎` : "FREE";
  const mint = card.id ? `${card.id.slice(0, 4)}…${card.id.slice(-4)}` : "—";
  const kindLabel = card.type === "workflow" ? "Workflow" : "Skill";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-5"
      style={{ background: "rgba(6,9,11,0.74)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
      onClick={onClick}
    >
      <div className="an-rcpt unlock-flicker">
        <div className="an-rcpt-meta"><span>&gt;TX_CONFIRMED</span><span>取得完了</span></div>
        <div className="flex items-stretch gap-2.5">
          <div className="flex flex-col" style={{ flex: "0 0 118px" }}>
            <div className="relative flex-1 overflow-hidden" style={{ minHeight: 118, border: "1px solid var(--an-green-line)" }}>
              <svg viewBox="0 0 120 150" preserveAspectRatio="xMidYMid slice" className="block h-full w-full" aria-hidden="true" dangerouslySetInnerHTML={{ __html: sigil }} />
              <div className="pointer-events-none absolute inset-0" style={{ background: SCANLINES }} />
            </div>
            <div className="an-rcpt-banner">Skill Acquired</div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
            <span className="an-rcpt-k">{kindLabel}</span>
            <p className="an-rcpt-name">&gt;{card.name}<span className="unlock-cursor">_</span></p>
            <div className="an-rcpt-row"><span className="an-rcpt-k">Paid</span><span>{paid}</span></div>
            <div className="an-rcpt-row"><span className="an-rcpt-k">Mint</span><span style={{ color: "var(--an-green)" }}>{mint}</span></div>
            <div className="mt-auto flex flex-col gap-1.5">
              <span className="an-rcpt-k">Sync</span>
              <div className="an-rcpt-seg">{[0, 1, 2, 3, 4].map((i) => <span key={i} className="on" />)}</div>
            </div>
          </div>
        </div>
        <div style={{ height: 1, background: "var(--an-line)", margin: "12px 0 10px" }} />
        <p className="an-rcpt-foot">Equipped on your agent and ready to run.</p>
      </div>
    </div>
  );
}
