import { useEffect } from "react";
import { haptics } from "../haptics";
import { CompleteOverlay } from "./CompleteOverlay";

// The verified-work twin of Buy/Publish celebrations: same green LED COMPLETE plaque, shown
// when a GitHub repo is registered as verified work. App owns the fire-once trigger (a new
// successful workRepoResult), so it fires even if the profile sheet closes.
export function RepoRegisterCelebration({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    haptics.celebrate();
    const t = setTimeout(onDone, 1800);
    return () => clearTimeout(t);
  }, []);

  return <CompleteOverlay label="WORK REGISTERED" onClick={onDone} />;
}
