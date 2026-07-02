// Green LED dot-matrix "COMPLETE" plaque (design "OVERLAY // COMPLETE"). One plaque, only
// the [CONTEXT] sub-label swaps per action. Presentational only: callers own the timing,
// haptics, and dismissal. Styling lives in index.css (.cmp-*) so it mirrors the VS Code
// webview's plaque exactly.
export function CompleteOverlay({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(6,9,11,0.74)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
      onClick={onClick}
    >
      <div className="cmp-wrap">
        <div className="cmp-plaque">
          <div className="cmp-led">
            <span>COMPLETE</span>
          </div>
        </div>
        <div className="cmp-label">[{label}]</div>
      </div>
    </div>
  );
}
