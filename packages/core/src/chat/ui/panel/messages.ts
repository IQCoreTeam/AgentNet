// Panel module cut from the legacy webview script (issue #215). Bodies are verbatim apart from
// the S.<name> state rewrite.
import { S } from "./state.js";
import { renderMd } from "./markdown.js";
import { cancelStreamRender, scheduleStreamRender, stickToBottom } from "./shell.js";
import { addFooter, addMsgCopy, bubble, renderSummary, renderTool, startTurn, tailBody } from "./turns.js";

export function onMessage(msg) {
  // a user command OPENS a new turn (its sticky header); everything after attaches
  // to that turn until the next user command.
  if (msg.role === 'user') {
    // live thumbnails if THIS echo matches the images we just sent; otherwise (history
    // replay) a lightweight "N image" chip from the stored count — base64 isn't persisted.
    const info = S.pendingSentImages.length ? { thumbs: S.pendingSentImages.splice(0) }
               : msg.imageCount ? { count: msg.imageCount } : undefined;
    const body = startTurn(msg.text, undefined, info);
    if (S.typingEl) body.appendChild(S.typingEl);
    return;
  }
  if (msg.role === 'tool') { renderTool(msg, false); return; }
  if (msg.role === 'summary') { renderSummary(msg.text, false); return; }
  // Badge = the engine that ACTUALLY produced this message (msg.cli, stamped by
  // the runtime). NO fallback to the current tab — if a message has no cli (old
  // session saved before per-message cli), we show no badge rather than a wrong,
  // tab-following one. So badges never flip when you switch tabs.
  // assistant / thinking reply nodes (badge only on assistant). The turn was
  // already opened by the preceding user message.
  const badge = (msg.role === 'assistant' && msg.cli) ? msg.cli : undefined;
  // assistant text is markdown; user/thinking stay plain. While streaming we show
  // raw accumulating text (cheap), then render md once the turn's text is complete.
  // Some runtimes send token deltas; others resend the full text-so-far. Accept both.
  const asMd = (el, raw) => { if (msg.role === 'assistant') renderMd(el, raw); else { el.textContent = raw; el.dataset.md = raw; } };
  if (msg.partial) {
    if (!S.streaming || S.streaming.dataset.role !== msg.role) {
      S.streaming = bubble(msg.role, false, badge);
      S.streaming.dataset.role = msg.role;
      S.streaming.dataset.acc = '';
      S.streaming.classList.add('cursor');
    }
    // Producers always send partials as the cumulative "full text so far"
    // (replace-semantics — see runtime/spawn.ts). So REPLACE the bubble, never
    // append. The old startsWith()+append heuristic desynced on any hiccup and
    // then compounded every later snapshot into quadratic repeated text (the
    // runaway streaming-duplication bug).
    S.streaming.dataset.acc = msg.text;
    scheduleStreamRender(); // live markdown + tail-follow, throttled to one paint/frame
    return; // stick/typing happens in flushStreamRender — no forced layout per token
  } else {
    if (S.streaming && S.streaming.dataset.role === msg.role) {
      const prev = S.streaming.dataset.acc || '';
      const raw = msg.text.startsWith(prev) ? msg.text : prev + msg.text;
      S.streaming.classList.remove('cursor');
      cancelStreamRender(); // drop any pending live render (rAF or trailing timer)
      asMd(S.streaming, raw);
      if (msg.role === 'assistant') addMsgCopy(S.streaming._row, S.streaming);
      S.streaming = null;
    } else {
      const el = bubble(msg.role, false, badge);
      asMd(el, msg.text);
      if (msg.role === 'assistant') { addFooter((el as any)._row, msg.durationMs, msg.model); addMsgCopy((el as any)._row, el); } // time + model + copy
    }
  }
  if (S.typingEl) tailBody().appendChild(S.typingEl); // keep the indicator at the thread's tail
  stickToBottom();
}
