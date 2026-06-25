import { useEffect } from "react";
import { SkillIcon } from "../icons";
import { haptics } from "../haptics";

const PARTICLE_COUNT = 6;

// The publish (forge) twin of BuyCelebration. Tinted by kind: skills forge violet,
// workflows forge amber (matching their card colors). Reuses the buy-particle / buy-pop
// keyframes (transform/opacity only, color-agnostic). App owns the fire-once trigger.
export function PublishCelebration({ kind, onDone }: { kind: "skill" | "workflow"; onDone: () => void }) {
  const particle = kind === "workflow" ? "text-amber-400" : "text-purple-400";
  const core = kind === "workflow" ? "text-amber-300" : "text-purple-300";

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
          className={`absolute h-6 w-6 ${particle} buy-particle`}
          style={{ "--angle": `${i * 60}deg` } as React.CSSProperties}
        />
      ))}
      <SkillIcon className={`h-14 w-14 ${core} buy-pop`} />
    </div>
  );
}
