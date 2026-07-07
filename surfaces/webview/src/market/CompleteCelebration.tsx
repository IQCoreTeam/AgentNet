import { useEffect } from "react";
import { haptics } from "../haptics";
import { CompleteOverlay } from "./CompleteOverlay";

// The ONE shared success celebration for every on-chain action (design "OVERLAY // COMPLETE —
// 공용 완료"): the green LED dot-matrix plaque, with only the [CONTEXT] sub-label swapping per
// action (SKILL PURCHASED / WORKFLOW PURCHASED / SKILL CREATED / WORKFLOW BUILT / COMMENT POSTED
// / POST PUBLISHED / GITHUB REGISTERED). Callers pass the label + onDone; this owns the haptic
// buzz and the ~1.8s auto-dismiss so no two success UIs can drift apart.
export function CompleteCelebration({ label, onDone }: { label: string; onDone: () => void }) {
  useEffect(() => {
    haptics.celebrate();
    const t = setTimeout(onDone, 1800);
    return () => clearTimeout(t);
  }, []);

  return <CompleteOverlay label={label} onClick={onDone} />;
}
