import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { Message } from "./Message";

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
  const logLen = state.log.length;

  function scrollToLatest() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickToBottom.current = true;
    setShowPill(false);
  }

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickToBottom.current = atBottom;
    setShowPill(!atBottom);
    if (el.scrollTop < 100 && state.hasMore && !loadingOlder.current) {
      loadingOlder.current = true;
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

  // Only yank to bottom on stream update if the user hasn't scrolled away.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [state.log[logLen - 1]?.text]);

  return (
    <div className="relative min-w-0 flex-1 overflow-hidden">
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto px-3 py-3">
        <div className="mx-auto flex min-w-0 max-w-2xl flex-col gap-3">
          {state.hasMore && (
            <div className="py-1 text-center text-xs text-zinc-600">scroll up for older…</div>
          )}
          {logLen === 0 && !state.loading && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <p className="text-sm text-zinc-600">Send a message to start</p>
            </div>
          )}
          {state.log.map((msg, i) => (
            <Message key={i} msg={msg} />
          ))}
          {state.typing && (
            <div className="flex gap-1 px-1 text-zinc-500">
              <span className="animate-pulse">●</span>
              <span className="animate-pulse [animation-delay:150ms]">●</span>
              <span className="animate-pulse [animation-delay:300ms]">●</span>
            </div>
          )}
        </div>
      </div>
      {showPill && (
        <button
          onClick={scrollToLatest}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-zinc-700/90 px-3 py-1.5 text-xs text-zinc-200 shadow-lg backdrop-blur-sm active:bg-zinc-600"
        >
          ↓ latest
        </button>
      )}
    </div>
  );
}
