import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { haptics } from "../haptics";

// Terminal-style success popup: an electric flicker in (synced with a sharp haptic zap),
// holds briefly, then gets "absorbed" - shrinks toward a point and fades. No emoji, no
// soft grow/shrink bounce. Self-dismisses.
export function PostCelebration({ label, onDone }: { label: string; onDone: () => void }) {
  const [phase, setPhase] = useState<"in" | "out">("in");

  useEffect(() => {
    // Electric "zap": rapid stutter pulses + a final longer buzz, in step with the flicker.
    haptics.celebrate();
    const exit = setTimeout(() => setPhase("out"), 1150);
    const done = setTimeout(onDone, 1450);
    return () => { clearTimeout(exit); clearTimeout(done); };
  }, []);

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center">
      <style>{`
        @keyframes an-cele-flicker {
          0% { opacity: 0; }
          12% { opacity: 1; }
          24% { opacity: 0.2; }
          38% { opacity: 1; }
          52% { opacity: 0.5; }
          68% { opacity: 1; }
          100% { opacity: 1; }
        }
        @keyframes an-cele-absorb {
          0% { opacity: 1; transform: scale(1); filter: blur(0); }
          100% { opacity: 0; transform: scale(0.35); filter: blur(2px); }
        }
      `}</style>
      <div
        className="flex items-center gap-2 rounded-2xl px-4 py-3"
        style={{
          background: "var(--an-bg-1)",
          border: "1px solid var(--an-green-line)",
          boxShadow: "0 0 0 4px var(--an-green-dim), 0 0 18px var(--an-green-soft)",
          animation: phase === "in" ? "an-cele-flicker 240ms ease-out both" : "an-cele-absorb 280ms ease-in forwards",
        }}
      >
        <svg
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--an-green)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
        <span className="font-mono text-sm" style={{ color: "var(--an-fg)" }}>{label}</span>
      </div>
    </div>,
    document.body,
  );
}
