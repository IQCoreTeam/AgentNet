// Skeleton placeholders shown while a skill detail or the agent profile loads, so a tap
// feels responsive instead of dead air. Interim — the agent screen gets reworked later.

// One shimmering block. Rounding is passed per-use (Tailwind rounded-* classes), so callers
// control the shape. The fill is an OPAQUE colour-shimmer (.an-skel), not an opacity pulse, so
// overlapping placeholders fully occlude instead of stacking into darker patches.
function Bar({ className = "" }: { className?: string }) {
  return <div className={`an-skel ${className}`} />;
}

// One SD-card-shaped placeholder (cut corner + a grey data-chip hint bottom-left, no colour) so
// the skeleton matches the real SkillSdCard and the grid doesn't jump when cards land.
function SdSkel() {
  return (
    <div
      className="relative w-full overflow-hidden rounded-xl"
      style={{ aspectRatio: "108 / 150", clipPath: "polygon(0 0,79% 0,100% 13%,100% 100%,0 100%)" }}
    >
      <Bar className="h-full w-full" />
      <div className="an-skel-2 absolute bottom-1.5 left-1.5 h-6 w-2/5 rounded-sm" />
    </div>
  );
}

// One landscape agent-card placeholder that mirrors the real AgentBizCard's internal layout
// (frame, handle + signal, big name + tier tag, avatar + gauge + two stats, footer) so the
// directory shimmers in the right SHAPE and nothing jumps when the real cards land.
function AcSkel() {
  return (
    <div className="w-full rounded-md p-2" style={{ aspectRatio: "350 / 196", background: "#0a0a0c", border: "1px solid #34343a" }}>
      <div className="flex h-full flex-col rounded-sm p-2" style={{ border: "1px solid #2c2c32" }}>
        {/* top: handle + signal */}
        <div className="flex items-center justify-between">
          <Bar className="h-2 w-2/5 rounded" />
          <Bar className="h-2 w-9 rounded" />
        </div>
        {/* name row: big name + tier tag */}
        <div className="mt-2 flex items-end justify-between border-b pb-2" style={{ borderColor: "#2c2c32" }}>
          <Bar className="h-6 w-2/5 rounded" />
          <Bar className="h-3 w-12 rounded-sm" />
        </div>
        {/* body: avatar + gauge + two stats */}
        <div className="mt-2 flex flex-1 gap-2.5">
          <Bar className="w-16 shrink-0 rounded" />
          <div className="flex flex-1 flex-col justify-center gap-2">
            <Bar className="h-3 w-full rounded" />
            <div className="flex gap-1.5">
              <Bar className="h-7 flex-1 rounded" />
              <Bar className="h-7 flex-1 rounded" />
            </div>
          </div>
        </div>
        {/* footer */}
        <div className="mt-1.5 border-t pt-1.5" style={{ borderColor: "#2c2c32" }}>
          <Bar className="mx-auto h-2 w-1/3 rounded" />
        </div>
      </div>
    </div>
  );
}

// A stack of landscape agent-card placeholders (matches the cyberpunk AgentBizCard) so the agent
// directory shimmers in the right shape while the list loads.
export function AgentListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2.5 pt-1">
      {Array.from({ length: rows }).map((_, i) => (
        <AcSkel key={i} />
      ))}
    </div>
  );
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
        <Bar className="mt-6 h-14 w-full rounded-xl" />
      </div>
    </div>
  );
}

// A 3-col grid of SD-card placeholders for the market / My Skills lists while results load, so
// the area shows motion (in the real card shape) instead of flashing an empty state.
export function MarketListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="grid grid-cols-3 gap-3.5 pt-1">
      {Array.from({ length: rows }).map((_, i) => (
        <SdSkel key={i} />
      ))}
    </div>
  );
}

// Mirrors the redesigned agent profile: a large avatar booth, three stat plaques, the
// file-folder tabs, a horizontal WORK card, and chunky single-column skill rows.
export function AgentProfileSkeleton({ onBack }: { onBack?: () => void } = {}) {
  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <div className="flex-1 overflow-hidden">
        {/* hero */}
        <div className="px-4 pt-3" style={headerStyle}>
          <div className="flex items-center justify-between">
            {onBack ? (
              <button
                onClick={onBack}
                className="flex h-8 w-8 items-center justify-center rounded-full active:bg-zinc-800"
                style={{ color: "var(--an-fg-dim)" }}
                aria-label="Back"
              >
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4l-6 6 6 6" /></svg>
              </button>
            ) : (
              <Bar className="h-4 w-28 rounded-md" />
            )}
            <Bar className="h-7 w-28 rounded-full" />
          </div>
          <div className="mt-2 flex justify-center">
            <Bar className="h-40 w-3/5 rounded-3xl" />
          </div>
          <div className="-mt-6 grid grid-cols-3 gap-2">
            <Bar className="h-16 rounded-xl" />
            <Bar className="h-16 rounded-xl" />
            <Bar className="h-16 rounded-xl" />
          </div>
        </div>
        {/* file-folder tabs */}
        <div className="mt-3 flex gap-1.5 px-3">
          <Bar className="h-9 flex-1 rounded-t-xl" />
          <Bar className="h-9 flex-1 rounded-t-xl" />
        </div>
        {/* content: WORK banner cards (horizontal) + SD-card skills grid */}
        <div className="space-y-4 px-4 pt-4">
          <Bar className="h-3.5 w-20 rounded-md" />
          <div className="flex gap-3 overflow-hidden">
            <Bar className="h-[168px] w-[252px] shrink-0 rounded-2xl" />
            <Bar className="h-[168px] w-[140px] shrink-0 rounded-2xl" />
          </div>
          <Bar className="h-3.5 w-20 rounded-md" />
          <div className="grid grid-cols-3 gap-3.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <SdSkel key={i} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
