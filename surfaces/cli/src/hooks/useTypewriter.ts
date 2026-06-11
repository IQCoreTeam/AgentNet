import { useEffect, useState } from "react";
import { useDelight } from "../components/DelightProvider.js";

// Char-by-char reveal. Makes whole-turn delivery FEEL like streaming today; when the
// core starts emitting partial deltas, `text` simply grows and this still reveals the
// tail smoothly. Delight off → returns the full text instantly. `done` lets callers
// know when the reveal has caught up (e.g. to stop a cursor blink).
export function useTypewriter(text: string, cps = 120): { shown: string; done: boolean } {
  const { animate } = useDelight();
  const [n, setN] = useState(animate ? 0 : text.length);

  useEffect(() => {
    if (!animate) {
      setN(text.length);
      return;
    }
    if (n >= text.length) return;
    const step = Math.max(1, Math.round(cps / 30)); // reveal in small chunks at ~30fps
    const id = setInterval(() => {
      setN((c) => {
        const next = Math.min(text.length, c + step);
        if (next >= text.length) clearInterval(id);
        return next;
      });
    }, 1000 / 30);
    return () => clearInterval(id);
  }, [animate, text, cps, n]);

  return { shown: animate ? text.slice(0, n) : text, done: n >= text.length };
}
