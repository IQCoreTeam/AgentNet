import { useEffect } from "react";
import { haptics } from "../haptics";
import { CompleteOverlay } from "./CompleteOverlay";
import { SkillReceiptOverlay } from "./SkillReceiptOverlay";
import type { SkillCard } from "../transport/protocol";

// The shared success celebration for every on-chain action: the green LED dot-matrix plaque,
// with only the [CONTEXT] sub-label swapping per action (SKILL CREATED / WORKFLOW BUILT / COMMENT
// POSTED / GITHUB REGISTERED). A skill/workflow BUY passes `card` instead, which swaps the plaque
// for the receipt showing the real bought item. Either way this owns the haptic buzz and the
// ~1.8s auto-dismiss so no two success UIs can drift apart.
export function CompleteCelebration({ label, onDone, flicker = false, card }: { label: string; onDone: () => void; flicker?: boolean; card?: SkillCard | null }) {
  useEffect(() => {
    haptics.celebrate();
    const t = setTimeout(onDone, 1800);
    return () => clearTimeout(t);
  }, []);

  return card
    ? <SkillReceiptOverlay card={card} onClick={onDone} />
    : <CompleteOverlay label={label} onClick={onDone} flicker={flicker} />;
}
