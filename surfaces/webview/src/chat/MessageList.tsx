import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { Message } from "./Message";
import { IqLogo } from "../icons";
import { associateLiveImages, liveImagesFor, subscribeLiveImages, syncLiveSession } from "./liveImages";
import type { ChatMessage } from "../transport/protocol";

// Thumbnails for the images a user attached to a turn. The bytes live only in memory (the
// chat log keeps just a count), so when they're present we show real previews that open
// full-screen on tap; after a reload we fall back to a muted chip noting how many there were.
function ImageStrip({ ts, count, onOpen }: { ts?: number; count: number; onOpen: (url: string) => void }) {
  const urls = liveImagesFor(ts);
  if (urls && urls.length) {
    return (
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {urls.map((u, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onOpen(u)}
            className="block h-16 w-16 overflow-hidden rounded-lg border"
            style={{ borderColor: "var(--an-line)" }}
            aria-label="View image"
          >
            <img src={u} alt="" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
    );
  }
  return (
    <div
      className="mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]"
      style={{ background: "var(--an-bg-2)", border: "1px solid var(--an-line)", color: "var(--an-fg-mute)" }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
      </svg>
      {count}
    </div>
  );
}

function groupTurns(log: ChatMessage[]): Array<{ user: ChatMessage | null; items: ChatMessage[]; key: number }> {
  const turns: Array<{ user: ChatMessage | null; items: ChatMessage[]; key: number }> = [];
  let current: { user: ChatMessage | null; items: ChatMessage[]; key: number } | null = null;
  log.forEach((msg, index) => {
    if (msg.role === "user") {
      current = { user: msg, items: [], key: index };
      turns.push(current);
      return;
    }
    if (!current) {
      current = { user: null, items: [], key: index };
      turns.push(current);
    }
    current.items.push(msg);
  });
  return turns;
}

// The scrolling log. Anchors to the bottom as new messages arrive (unless the user has
// scrolled up), and asks for an older page when scrolled near the top — preserving the
// scroll offset so the viewport doesn't jump when older messages prepend.
// A "scroll to latest" pill appears whenever the user has scrolled away, so the stream
// never yanks them back involuntarily.
export function MessageList() {
  const { state, send } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const prevHeight = useRef(0);
  const loadingOlder = useRef(false);
  const [showPill, setShowPill] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const [, bumpImages] = useState(0);
  const logLen = state.log.length;
  const turns = groupTurns(state.log);

  // Live image thumbnails: re-render when a send gets paired to its echoed message, drop the
  // cache when the visible session changes, and pair queued sends to user turns as they land.
  useEffect(() => subscribeLiveImages(() => bumpImages((v) => v + 1)), []);
  useEffect(() => { syncLiveSession(state.activeSessionId ?? ""); }, [state.activeSessionId]);
  useEffect(() => {
    for (const m of state.log) {
      if (m.role === "user" && m.imageCount && m.ts != null) associateLiveImages(m.ts);
    }
  }, [state.log]);

  function scrollToLatest() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickToBottom.current = true;
    setShowPill(false);
    setUnseen(false);
  }

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickToBottom.current = atBottom;
    setShowPill(!atBottom);
    if (atBottom) setUnseen(false);
    if (el.scrollTop < 100 && state.hasMore && !loadingOlder.current) {
      loadingOlder.current = true;
      setOlderLoading(true);
      prevHeight.current = el.scrollHeight;
      send({ type: "loadMore", cursor: state.cursor });
    }
  }

  // After messages change: if we were loading older, restore offset (no jump); otherwise
  // stick to the bottom for new turns.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (loadingOlder.current && prevHeight.current) {
      el.scrollTop = el.scrollHeight - prevHeight.current;
      loadingOlder.current = false;
      prevHeight.current = 0;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logLen]);

  // Clear the older-page spinner once the response lands (cursor advances or there's
  // no more), covering the rare empty-page case where logLen doesn't change.
  useEffect(() => {
    setOlderLoading(false);
    loadingOlder.current = false;
  }, [state.cursor, state.hasMore]);

  // A short latest page (e.g. only 2 messages) doesn't overflow, so onScroll never fires
  // and older history is unreachable. Auto-pull older pages until the viewport fills or
  // there's nothing more. Runs after each page lands (logLen/cursor change); reuses the
  // scroll-up path so the offset restore keeps the latest messages visually pinned.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !state.hasMore || loadingOlder.current) return;
    if (el.scrollHeight <= el.clientHeight + 4) {
      loadingOlder.current = true;
      setOlderLoading(true);
      prevHeight.current = el.scrollHeight;
      send({ type: "loadMore", cursor: state.cursor });
    }
  }, [logLen, state.hasMore, state.cursor]);

  // Only yank to bottom on stream update if the user hasn't scrolled away; if they HAVE
  // scrolled away and the AGENT adds new content at the bottom, light the jump button.
  // Keyed on the LAST message's signature so loading OLDER pages (which prepend at the
  // top, leaving the last message unchanged) never falsely activates it.
  const lastSig = useRef("");
  useEffect(() => {
    const el = scrollRef.current;
    const last = state.log[logLen - 1];
    const sig = last ? `${last.role}:${last.text.length}` : "";
    const changed = sig !== lastSig.current;
    lastSig.current = sig;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
    else if (changed && (last?.role === "assistant" || last?.role === "thinking")) setUnseen(true);
  }, [state.log[logLen - 1]?.text, logLen]);

  // The active engine tints the send + jump-to-latest controls (claude = orange, codex
  // = green) so the chrome matches the platform you're talking to.
  const engineAccent = state.cli === "claude" ? "var(--claude)" : "var(--an-green)";

  return (
    <div className="relative min-w-0 flex-1 overflow-hidden">
      {/* Empty / loading state, centered in the whole chat viewport (both axes) rather than
          pinned near the top — an absolute overlay so it ignores scroll-area padding. */}
      {logLen === 0 && (
        // Centered in the space ABOVE the composer + tab bar (bottom padding offsets the
        // chrome), so the logo reads as visually centered rather than sitting too low.
        <div
          className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-6 px-3 text-center"
          style={{ paddingBottom: "max(0px, calc(var(--chat-float-height, 0px) + var(--tabbar-height, 0px) - 3rem))" }}
        >
          {state.loading ? (
            <>
              <span
                className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent"
                style={{ color: "var(--an-green)" }}
              />
              <p className="text-sm" style={{ color: "var(--an-fg-mute)" }}>Loading chat…</p>
            </>
          ) : (
            <IqLogo className="h-32 w-32" style={{ color: "var(--an-fg-mute)", opacity: 0.55 }} />
          )}
        </div>
      )}
      <div ref={scrollRef} onScroll={onScroll} className="an-message-scroll h-full overflow-y-auto px-3 pb-3 pt-0" style={{ touchAction: "pan-y" }}>
        <div className="mx-auto flex min-w-0 max-w-2xl flex-col">
          {/* In-flow above the first turn: scrolling up past the sticky head reveals it,
              and its padding gives the top breathing room (inside the content, so it
              scrolls away — the sticky head sits flush once you scroll down). */}
          {state.hasMore && (
            <div className="flex justify-center pb-3 pt-3">
              <span
                className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs"
                style={{ background: "var(--an-bg-2)", border: "1px solid var(--an-line)", color: "var(--an-fg-dim)" }}
              >
                {olderLoading && (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                )}
                {olderLoading ? "loading older…" : "scroll up for older…"}
              </span>
            </div>
          )}
          {turns.map((turn) => (
            <section key={turn.key} className="an-turn">
              {turn.user && (
                <div className="an-turn-head">
                  <span className="an-turn-marker">&gt;</span>
                  {/* Wrapper splits the clamped text from the thumbnails: .an-turn-text uses
                      -webkit-line-clamp + overflow:hidden, which would otherwise clip the
                      images. Keeping the strip a sibling lets it show under the sticky prompt. */}
                  <div className="min-w-0 flex-1">
                    <div className="an-turn-text">
                      {turn.user.text}
                      {turn.user._pending && (
                        <span className="ml-2 inline-block animate-pulse text-[10px]" style={{ color: "var(--an-fg-mute)" }}>sending</span>
                      )}
                    </div>
                    {turn.user.imageCount ? (
                      <ImageStrip ts={turn.user.ts} count={turn.user.imageCount} onOpen={setZoom} />
                    ) : null}
                  </div>
                </div>
              )}
              <div className="an-turn-body">
                {turn.items.map((msg, i) => (
                  <div
                    key={`${turn.key}:${i}`}
                    className={[
                      "an-node",
                      msg.role === "assistant" ? "assistant" : "",
                      msg.role === "thinking" ? "thinking" : "",
                      msg.cli === "claude" ? "claude" : "",
                    ].join(" ")}
                  >
                    <Message msg={msg} />
                  </div>
                ))}
              </div>
            </section>
          ))}
          {state.typing && (
            <div className="flex items-center gap-1.5 px-1 py-1.5" aria-label="Assistant is responding">
              <span className="an-typing-dot" style={{ background: engineAccent }} />
              <span className="an-typing-dot [animation-delay:160ms]" style={{ background: engineAccent }} />
              <span className="an-typing-dot [animation-delay:320ms]" style={{ background: engineAccent }} />
            </div>
          )}
        </div>
      </div>
      {/* Jump-to-latest: a round arrow button that sits just above the composer (never
          over it). Goes active (green) when new messages arrived while scrolled away. */}
      {showPill && (
        <button
          onClick={scrollToLatest}
          aria-label="Scroll to latest"
          className={`an-jump-latest ${unseen ? "is-unseen" : ""}`}
          style={unseen ? { color: engineAccent, borderColor: engineAccent } : undefined}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 3v11M4.5 9.5L9 14l4.5-4.5" />
          </svg>
        </button>
      )}
      {/* Full-screen image viewer: tap a thumbnail to open, tap anywhere to dismiss. */}
      {zoom && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.9)" }}
          onClick={() => setZoom(null)}
          role="dialog"
          aria-label="Image preview"
        >
          <img src={zoom} alt="" className="max-h-[92vh] max-w-[94vw] object-contain" />
        </div>
      )}
    </div>
  );
}
