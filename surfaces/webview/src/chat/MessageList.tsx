import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { Message } from "./Message";
import { IqLogo } from "../icons";
import type { ChatMessage } from "../transport/protocol";

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
  const [olderLoading, setOlderLoading] = useState(false);
  const logLen = state.log.length;
  const turns = groupTurns(state.log);

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

  // Only yank to bottom on stream update if the user hasn't scrolled away.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [state.log[logLen - 1]?.text]);

  return (
    <div className="relative min-w-0 flex-1 overflow-hidden">
      {/* Empty / loading state, centered in the whole chat viewport (both axes) rather than
          pinned near the top — an absolute overlay so it ignores scroll-area padding. */}
      {logLen === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-6 px-3 text-center">
          {state.loading ? (
            <>
              <span
                className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent"
                style={{ color: "var(--an-green)" }}
              />
              <p className="text-sm" style={{ color: "var(--an-fg-mute)" }}>Loading chat…</p>
            </>
          ) : (
            <>
              <IqLogo className="h-24 w-24" style={{ color: "var(--an-fg-mute)", opacity: 0.55 }} />
              <p className="text-sm text-zinc-600">Send a message to start</p>
            </>
          )}
        </div>
      )}
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto px-3 py-3" style={{ touchAction: "pan-y" }}>
        <div className="mx-auto flex min-w-0 max-w-2xl flex-col">
          {state.hasMore && (
            <div className="flex items-center justify-center gap-2 py-1 text-center text-xs text-zinc-600">
              {olderLoading && (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              )}
              {olderLoading ? "loading older…" : "scroll up for older…"}
            </div>
          )}
          {turns.map((turn) => (
            <section key={turn.key} className="an-turn">
              {turn.user && (
                <div className="an-turn-head">
                  <span className="an-turn-marker">&gt;</span>
                  <div className="an-turn-text">
                    {turn.user.text}
                    {turn.user._pending && (
                      <span className="ml-2 inline-block animate-pulse text-[10px]" style={{ color: "var(--an-fg-mute)" }}>sending</span>
                    )}
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
