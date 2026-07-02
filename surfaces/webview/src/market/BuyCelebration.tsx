import { useEffect } from "react";
import { useStore } from "../state/store";
import { haptics } from "../haptics";
import { CompleteOverlay } from "./CompleteOverlay";

// Purchase confirmation: the green LED COMPLETE plaque (design "OVERLAY // COMPLETE").
// Shown for both the UI buy and a chat/agent buy (both route through the buyResult event).
export function BuyCelebration() {
  const { clearCelebrate } = useStore();

  useEffect(() => {
    haptics.celebrate();
    const t = setTimeout(clearCelebrate, 2000);
    return () => clearTimeout(t);
  }, []);

  return <CompleteOverlay label="SKILL PURCHASED" onClick={clearCelebrate} />;
}
