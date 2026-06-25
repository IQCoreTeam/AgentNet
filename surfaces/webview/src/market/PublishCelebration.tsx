import { useEffect } from "react";
import { SkillIcon } from "../icons";
import { haptics } from "../haptics";

const PARTICLE_COUNT = 6;

// The publish (forge) twin of BuyCelebration: violet to match the forge approval card.
// Reuses the buy-particle / buy-pop keyframes (transform/opacity only, color-agnostic).
// Driven by an onDone callback rather than a store flag — App owns the fire-once trigger.
export function PublishCelebration({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    haptics.celebrate();
    const t = setTimeout(onDone, 1600);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
      {Array.from({ length: PARTICLE_COUNT }).map((_, i) => (
        <SkillIcon
          key={i}
          className="absolute h-6 w-6 text-purple-400 buy-particle"
          style={{ "--angle": `${i * 60}deg` } as React.CSSProperties}
        />
      ))}
      <SkillIcon className="h-14 w-14 text-purple-300 buy-pop" />
    </div>
  );
}
