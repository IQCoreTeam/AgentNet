import { createPortal } from "react-dom";

// Green LED dot-matrix "COMPLETE" plaque (design "OVERLAY // COMPLETE"). One plaque, only
// the [CONTEXT] sub-label swaps per action. Presentational only: callers own the timing,
// haptics, and dismissal. Styling lives in index.css (.cmp-*) so it mirrors the VS Code
// webview's plaque exactly.
export function CompleteOverlay({ label, onClick, flicker = false }: { label: string; onClick?: () => void; flicker?: boolean }) {
  // flicker: turn the plaque on with the CRT flicker (like the unlock tutorial) instead of the
  // pop. The flicker rides an outer wrapper (its .unlock-flicker class is reduced-motion-safe),
  // and the inner plaque's pop is switched off so it reads as a pure blink-on.
  const plaque = (
    <div className="cmp-wrap" style={flicker ? { animation: "none" } : undefined}>
      <div className="cmp-plaque">
        <div className="cmp-led">
          <span>COMPLETE</span>
        </div>
      </div>
      <div className="cmp-label">[{label}]</div>
    </div>
  );
  // Portal to <body>: this overlay is often rendered from views that live inside the
  // swipe pager, whose ancestors carry a CSS transform (and will-change: transform).
  // A transformed ancestor makes position:fixed resolve against THAT ancestor, not the
  // viewport, so `fixed inset-0` lands off-screen (the 400%-wide, translated pager
  // track). Portaling out to body restores true viewport centering everywhere, matching
  // the createPortal pattern the profile sheet and FundModal already use.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(6,9,11,0.74)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
      onClick={onClick}
    >
      {flicker ? <div className="unlock-flicker">{plaque}</div> : plaque}
    </div>,
    document.body,
  );
}
