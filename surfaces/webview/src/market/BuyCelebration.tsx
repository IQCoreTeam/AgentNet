import { useEffect } from "react";
import { useStore } from "../state/store";
import { SkillIcon } from "../icons";
import { haptics } from "../haptics";

const PARTICLE_COUNT = 5;

export function BuyCelebration() {
  const { clearCelebrate } = useStore();

  useEffect(() => {
    haptics.celebrate();
    const t = setTimeout(clearCelebrate, 1600);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
      {Array.from({ length: PARTICLE_COUNT }).map((_, i) => (
        <SkillIcon
          key={i}
          className="absolute h-6 w-6 text-amber-400 buy-particle"
          style={{ "--angle": `${i * 72}deg` } as React.CSSProperties}
        />
      ))}
      <SkillIcon className="h-14 w-14 text-amber-300 buy-pop" />
    </div>
  );
}
