// Skeleton placeholders shown while a skill detail or the agent profile loads, so a tap
// feels responsive instead of dead air. Interim — the agent screen gets reworked later.

// One shimmering block. Rounding is passed per-use (Tailwind rounded-* classes), so callers
// control the shape; the muted fill + pulse come from here.
function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse ${className}`} style={{ background: "var(--an-bg-2)" }} />;
}

const headerStyle = { paddingTop: "max(0.5rem, env(safe-area-inset-top))" } as const;

export function SkillDetailSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <header className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2" style={headerStyle}>
        <button
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-full active:bg-zinc-800"
          style={{ color: "var(--an-fg-dim)" }}
          aria-label="Back"
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4l-6 6 6 6" /></svg>
        </button>
        <Bar className="h-4 w-28 rounded-md" />
      </header>
      <div className="flex-1 overflow-hidden px-4 py-4">
        <div className="flex items-center gap-3">
          <Bar className="h-14 w-14 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Bar className="h-5 w-2/3 rounded-md" />
            <Bar className="h-3.5 w-1/3 rounded-md" />
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Bar className="h-6 w-16 rounded-full" />
          <Bar className="h-6 w-20 rounded-full" />
          <Bar className="h-6 w-14 rounded-full" />
        </div>
        <div className="mt-5 space-y-2.5">
          <Bar className="h-3.5 w-full rounded-md" />
          <Bar className="h-3.5 w-11/12 rounded-md" />
          <Bar className="h-3.5 w-4/5 rounded-md" />
          <Bar className="h-3.5 w-2/3 rounded-md" />
        </div>
        <Bar className="mt-6 h-11 w-full rounded-xl" />
      </div>
    </div>
  );
}

// A list of shimmering rows for the market / skills / agents lists while results load, so
// the area shows motion instead of flashing an empty "none found" state before data lands.
export function MarketListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 pt-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-xl border border-zinc-800 p-3"
          style={{ background: "var(--an-bg-1)" }}
        >
          <Bar className="h-10 w-10 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Bar className="h-3.5 w-2/5 rounded-md" />
            <Bar className="h-2.5 w-3/5 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AgentProfileSkeleton() {
  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <header className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2" style={headerStyle}>
        <Bar className="h-4 w-24 rounded-md" />
      </header>
      <div className="flex-1 overflow-hidden px-4 py-5">
        <div className="flex flex-col items-center gap-3">
          <Bar className="h-20 w-20 rounded-full" />
          <Bar className="h-4 w-32 rounded-md" />
          <Bar className="h-3 w-44 rounded-md" />
        </div>
        <div className="mt-6 flex gap-3">
          <Bar className="h-16 flex-1 rounded-xl" />
          <Bar className="h-16 flex-1 rounded-xl" />
          <Bar className="h-16 flex-1 rounded-xl" />
        </div>
        <Bar className="mt-6 h-4 w-24 rounded-md" />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Bar className="h-24 rounded-xl" />
          <Bar className="h-24 rounded-xl" />
          <Bar className="h-24 rounded-xl" />
          <Bar className="h-24 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
