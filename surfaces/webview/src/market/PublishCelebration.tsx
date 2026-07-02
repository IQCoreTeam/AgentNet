import { useEffect } from "react";
import { haptics } from "../haptics";
import { CompleteOverlay } from "./CompleteOverlay";

// The publish (forge) twin of BuyCelebration: same green LED COMPLETE plaque, label reflects
// what was minted. App owns the fire-once trigger.
export function PublishCelebration({ kind, onDone }: { kind: "skill" | "workflow"; onDone: () => void }) {
  useEffect(() => {
    haptics.celebrate();
    const t = setTimeout(onDone, 1800);
    return () => clearTimeout(t);
  }, []);

  return <CompleteOverlay label={kind === "workflow" ? "WORKFLOW BUILT" : "SKILL CREATED"} onClick={onDone} />;
}
