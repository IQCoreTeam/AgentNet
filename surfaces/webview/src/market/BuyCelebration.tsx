import { useEffect } from "react";
import { useStore } from "../state/store";
import { SkillIcon } from "../icons";
import { haptics } from "../haptics";

const PARTICLE_COUNT = 5;

// Purchase confirmation card. An OPAQUE scrim + solid card sit it clearly ABOVE the screen
// (it used to be bare particles over a transparent overlay, which blended in awkwardly).
// Shown for both the UI buy and a chat/agent buy (both route through the buyResult event).
export function BuyCelebration() {
  const { state, clearCelebrate } = useStore();
  const label = state.buyCelebrateLabel;

  useEffect(() => {
    haptics.celebrate();
    const t = setTimeout(clearCelebrate, 2000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-8"
      style={{ background: "rgba(0,0,0,0.72)" }}
      onClick={clearCelebrate}
    >
      <div className="relative flex w-full max-w-xs flex-col items-center gap-3 rounded-2xl border border-amber-500/40 bg-[var(--an-bg-1)] px-6 py-7 text-center shadow-2xl">
        {/* gold burst around the icon */}
        {Array.from({ length: PARTICLE_COUNT }).map((_, i) => (
          <SkillIcon
            key={i}
            className="absolute top-7 h-5 w-5 text-amber-400 buy-particle"
            style={{ "--angle": `${i * 72}deg` } as React.CSSProperties}
          />
        ))}
        <SkillIcon className="h-12 w-12 text-amber-300 buy-pop" />
        <p className="text-base font-semibold text-amber-200">Skill purchased</p>
        {label && <p className="font-mono text-xs text-[var(--an-fg-mute)] break-all">{label}</p>}
        <p className="text-[11px] text-[var(--an-fg-mute)]">Equipped and ready to use.</p>
      </div>
    </div>
  );
}
