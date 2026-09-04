// Panel module cut from the legacy webview script (issue #215). Bodies are verbatim apart from
// the S.<name> state rewrite. Top-level statements live in wirePaging() because ESM evaluates
// modules in dependency order, and main.ts calls the wire functions in the legacy order so
// listener registration and boot posts keep their sequence.
import { S } from "./state.js";
import { vscode } from "./host.js";
import { log } from "./dom.js";
import { renderMd } from "./markdown.js";
import { nearBottom, updateJump } from "./shell.js";
import { addFooter, addMsgCopy, makeUtext, renderToolInto } from "./turns.js";
import { userImagesEl } from "./composer.js";

// ---- scroll-to-top → load older page ----
export function resetPaging() { S.pageCursor = null; S.hasMore = false; S.loadingOlder = false; S.lastOlderCursor = null; }

// Prepend older messages while keeping the viewport pinned (no jump): measure
// scroll height before/after and restore the offset.
// Prepend an OLDER page (scroll-up). We build the page's turns into a detached
// fragment IN ORDER (so user commands open turns correctly), then insert the whole
// fragment above the current content — keeping scroll position stable.
export function prependOlder(messages) {
  const before = log.scrollHeight;
  const realLog = log;
  const frag = document.createElement('div');
  let body = null; // current turn body within the fragment
  const openTurn = (userText, badge, imageCount?) => {
    const turn = document.createElement('div'); turn.className = 'turn';
    const head = document.createElement('div'); head.className = 'turnHead';
    head.innerHTML = '<span class="uq">&gt;</span>';
    head.appendChild(makeUtext(userText));
    if (badge) { const b = document.createElement('span'); b.className = 'badge ' + badge;
      b.textContent = badge === 'codex' ? 'codex · gpt' : 'claude'; head.appendChild(b); }
    const imgEl = userImagesEl(imageCount ? { count: imageCount } : undefined);
    if (imgEl) head.appendChild(imgEl);
    const b = document.createElement('div'); b.className = 'turnBody';
    turn.appendChild(head); turn.appendChild(b); frag.appendChild(turn); return b;
  };
  const node = (cls) => { const n = document.createElement('div'); n.className = 'node ' + cls;
    (body || (body = openTurn('', undefined))).appendChild(n); return n; };
  for (const m of messages) {
    if (m.role === 'user') { body = openTurn(m.text, undefined, m.imageCount); continue; }
    if (m.role === 'tool') { renderToolInto(node('tool'), m); continue; }
    if (m.role === 'summary') {
      const n = node('summary');
      n.innerHTML = '<div class="compactRule"><div class="ln"></div><span class="lbl">⌘ context compacted</span><div class="ln"></div></div>';
      const sb = document.createElement('div'); sb.className = 'summaryBody'; sb.textContent = m.text; n.appendChild(sb);
      continue;
    }
    const n = node(m.role + (m.role === 'assistant' && m.cli ? ' ' + m.cli : ''));
    const el = document.createElement('div'); el.className = 'msg ' + m.role;
    if (m.role === 'assistant') renderMd(el, m.text); else { el.textContent = m.text; el.dataset.md = m.text; }
    n.appendChild(el);
    if (m.role === 'assistant') { addFooter(n, m.durationMs, m.model); addMsgCopy(n, el); }
  }
  // Insert above the current content, then restore the viewport SYNCHRONOUSLY (before the
  // browser paints) so the user's position never visibly jumps. Disable smooth-scroll for
  // the correction — otherwise the scrollTop bump animates and reads as a jump. Late-loading
  // images that grow the prepended block are handled natively by overflow-anchor on #log.
  const prevBehavior = realLog.style.scrollBehavior;
  realLog.style.scrollBehavior = 'auto';
  realLog.insertBefore(frag, realLog.firstChild);
  void realLog.offsetHeight; // force layout so scrollHeight is accurate
  realLog.scrollTop += realLog.scrollHeight - before;
  realLog.style.scrollBehavior = prevBehavior;
}

export function requestOlder() {
  // pageCursor !== lastOlderCursor: a well-behaved host always answers with a SMALLER
  // cursor, so this is normally true. If a host ever returns hasMore:true without
  // advancing the cursor (e.g. an empty page bug), this stops the loadMore ping-pong
  // instead of spinning forever through maybeFillOlder's re-check.
  if (S.hasMore && !S.loadingOlder && S.pageCursor !== null && S.pageCursor !== S.lastOlderCursor) {
    S.loadingOlder = true;
    S.lastOlderCursor = S.pageCursor;
    vscode.postMessage({ type: 'loadMore', cursor: S.pageCursor });
  }
}

// When the loaded content doesn't overflow the viewport there is no scrollbar, so the
// 'scroll' listener can never fire to fetch older pages — older history would be
// unreachable. Proactively pull the next older chunk whenever there's nothing to scroll;
// this chains (each 'older' re-checks) until the log overflows or no pages remain.
export function maybeFillOlder() {
  if (log.scrollHeight <= log.clientHeight) requestOlder();
}

export function wirePaging() {

  log.addEventListener('scroll', () => {
    // preemptive load: fetch the next older page BEFORE the user hits the very top, so there
    // is always more scroll above and they never slam into the edge (which read as a jump).
    if (log.scrollTop < 600) requestOlder();
    // track pin state: stay pinned (auto-scroll) only while near the bottom, else show the
    // jump button. User scrolling is direct (not smooth), so this reads the true position.
    S.stick = nearBottom(); updateJump();
  });
}
