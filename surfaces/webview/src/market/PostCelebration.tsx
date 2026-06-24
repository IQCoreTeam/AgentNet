import { useEffect } from "react";
import { createPortal } from "react-dom";

// Terminal-style success celebration. A brief centered card with a check glyph + a short
// mono line, plus a light haptic tick. Fires only on real milestones (blog post, comment,
// verified-repo registration), matching the design-system "calm baseline, earned
// celebration" rule. No emoji - the check is an SVG. Self-dismisses.
export function PostCelebration({ label, onDone }: { label: string; onDone: () => void }) {
  useEffect(() => {
    // Short double tick - present but not noisy. Guarded: many WebViews lack the API.
    try { navigator.vibrate?.([14, 40, 20]); } catch { /* unsupported on this WebView */ }
    const t = setTimeout(onDone, 1500);
    return () => clearTimeout(t);
  }, []);

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center">
      <div
        className="buy-pop flex items-center gap-2 rounded-2xl px-4 py-3"
        style={{
          background: "var(--an-bg-1)",
          border: "1px solid var(--an-green-line)",
          boxShadow: "0 0 0 4px var(--an-green-dim)",
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
