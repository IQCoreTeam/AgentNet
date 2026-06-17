import { useEffect } from "react";
import { useStore } from "../state/store";

const PARTICLES = ["✨", "🎉", "⭐", "💫", "🌟"];

export function BuyCelebration() {
  const { clearCelebrate } = useStore();

  useEffect(() => {
    const t = setTimeout(clearCelebrate, 1600);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className="absolute text-2xl buy-particle"
          style={{ "--angle": `${i * 72}deg` } as React.CSSProperties}
        >
          {p}
        </span>
      ))}
      <span className="text-5xl buy-pop">🎉</span>
    </div>
  );
}
