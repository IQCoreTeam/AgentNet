// Panel module cut from the legacy webview script (issue #215). Bodies are verbatim apart from
// the S.<name> state rewrite. Top-level statements live in wireShell() because ESM evaluates
// modules in dependency order, and main.ts calls the wire functions in the legacy order so
// listener registration and boot posts keep their sequence.
import { S } from "./state.js";
// The core table directly: engine.ts imports this module, so no alias lives there.
import { ENGINE_INSTALL_COMMAND } from "../../../runtime/engineInstall.js";
import { vscode } from "./host.js";
import { engineBanner, jumpBtn, loadingEl, log, mainEl } from "./dom.js";
import { renderMdStreaming } from "./markdown.js";
import { tailBody } from "./turns.js";

// hide the IQ watermark once the chat has any content; show it on an empty log
export function syncWatermark() { mainEl.classList.toggle('hasMsgs', log.childElementCount > 0); }
export function renderNotice(text) {
  const notice = document.createElement('div');
  notice.style.cssText = 'padding:4px 12px;font-size:0.82em;opacity:0.65;white-space:pre-wrap';
  notice.textContent = text;
  log.appendChild(notice); syncWatermark(); stickToBottom();
}
// A notice with action buttons (install/update an engine). Same visual weight as
// renderNotice; each action is [label, onClick(btn)].
export function renderActionNotice(text, actions) {
  const notice = document.createElement('div');
  notice.style.cssText = 'padding:4px 12px;font-size:0.82em;white-space:pre-wrap';
  const body = document.createElement('div');
  body.style.opacity = '0.65';
  body.textContent = text;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;margin-top:6px';
  for (const a of actions) {
    const btn = document.createElement('button');
    btn.textContent = a[0];
    btn.style.cssText = 'padding:3px 10px;font-size:1em';
    btn.addEventListener('click', () => a[1](btn));
    row.appendChild(btn);
  }
  notice.appendChild(body); notice.appendChild(row);
  log.appendChild(notice); syncWatermark(); stickToBottom();
}
export function copyAction(command) {
  return ['Copy command', (btn) => {
    if (navigator.clipboard) navigator.clipboard.writeText(command).catch(() => {});
    btn.textContent = 'Copied';
  }];
}
// Engine-update banner: a persistent, dismissible bar rendered OUTSIDE #log (so a chat
// repaint never clears it) with the action buttons kept clickable. Closing it tells the
// host to stop re-sending the update for this session (dismissKey = the cli), so a new
// chat does not flash it again.
export function renderEngineBanner(text, actions, dismissKey) {
  engineBanner.innerHTML = '';
  const body = document.createElement('div');
  body.className = 'eb-body';
  body.textContent = text;
  const row = document.createElement('div');
  row.className = 'eb-actions';
  for (const a of actions) {
    const btn = document.createElement('button');
    btn.className = 'eb-btn';
    btn.textContent = a[0];
    btn.addEventListener('click', () => a[1](btn));
    row.appendChild(btn);
  }
  const close = document.createElement('button');
  close.className = 'eb-close';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '×';
  close.addEventListener('click', () => {
    engineBanner.style.display = 'none';
    engineBanner.innerHTML = '';
    vscode.postMessage({ type: 'dismissEngineUpdate', cli: dismissKey });
  });
  engineBanner.appendChild(body);
  engineBanner.appendChild(row);
  engineBanner.appendChild(close);
  engineBanner.style.display = 'flex';
}
// Missing engine: show how to get it instead of a dead-end "not installed" line.
// "Install in terminal" runs the command visibly host-side (user watches it run).
export function renderEngineMissing(which) {
  const name = which === 'claude' ? 'Claude' : 'Codex';
  const command = ENGINE_INSTALL_COMMAND[which];
  renderActionNotice(
    name + ' is not installed. Install it, then sign in with /login.\n$ ' + command,
    [
      ['Install in terminal', () => vscode.postMessage({ type: 'installEngine', cli: which })],
      copyAction(command),
    ]
  );
}
export function renderStatus(status) {
  const ctx = typeof status.contextTokens === 'number'
    ? (status.contextTokens >= 1000 ? Math.round(status.contextTokens / 1000) + 'k' : String(status.contextTokens))
    : 'unknown';
  const text = [
    'engine: ' + status.cli,
    'session: ' + (status.sessionId || '(none)'),
    'model: ' + (status.model || 'default'),
    'mode: ' + (status.mode || 'default'),
    'effort: ' + (status.effort || 'default'),
    'context tokens: ' + ctx,
  ].join('\n');
  const pre = document.createElement('pre');
  pre.style.cssText = 'margin:8px 0;padding:8px 12px;background:var(--an-bg-1);border-radius:6px;font-size:0.82em;opacity:0.85;white-space:pre-wrap';
  pre.textContent = text;
  log.appendChild(pre); syncWatermark(); stickToBottom();
}

// ---- stick-to-bottom + jump-to-latest (normal chat-app feel) ----
// Follow the newest message ONLY while the user is already near the bottom (a generous
// threshold, so light scrolling doesn't unpin). Once they scroll up we stop following the
// stream and reveal a round "down" button (bottom-right of the log) to jump back. The
// button is visible whenever scrolled up, so a new reply arriving up there is reachable in
// one click. Programmatic scrolls are forced INSTANT so the 'scroll' listener can't mistake
// a smooth animation's midpoint for "scrolled away".
export function nearBottom() {
  const d = log.scrollHeight - log.scrollTop - log.clientHeight;
  return d <= Math.max(180, log.clientHeight * 0.25); // generous "close enough to bottom"
}
export function toBottomInstant() {
  const prev = log.style.scrollBehavior;
  log.style.scrollBehavior = 'auto'; // bypass CSS smooth so we land exactly at the bottom
  log.scrollTop = log.scrollHeight;
  log.style.scrollBehavior = prev;
}
export function updateJump() {
  if (!jumpBtn) return;
  if (S.stick) S.hasNew = false;           // back at the bottom → nothing new to catch up on
  jumpBtn.classList.toggle('show', !S.stick);
  jumpBtn.classList.toggle('hasNew', S.hasNew); // engine-tinted (claude=orange / codex=green) when unread
}
export function stickToBottom() {              // auto-scroll only if pinned; otherwise flag unread
  if (S.stick) toBottomInstant(); else S.hasNew = true;
  updateJump();
}
export function scrollToLatest() { S.stick = true; S.hasNew = false; toBottomInstant(); updateJump(); } // force (new command / button)

// loading veil while a session is carried to the other engine (cross-CLI switch)
export function showLoading() { loadingEl.style.display = 'flex'; }
export function hideLoading() { loadingEl.style.display = 'none'; }

// Live rendering used to re-parse the WHOLE accumulated message every repaint
// (marked + DOMPurify + full innerHTML swap), so its cost grew with the reply and
// typing lagged across all of VS Code while a long reply streamed — webviews share
// the window's renderer process. Two defenses now: repaints happen on a coarse time
// cadence (deltas keep accumulating in dataset.acc between flushes), and each repaint
// is incremental (renderMdStreaming) so it costs O(growing tail block), not O(reply).
// The partial:false path still does the exact final full render — same end state.
export const STREAM_MD_MS = 300;
export function flushStreamRender() {
  S.streamRaf = 0;
  if (!S.streaming) return;
  S.lastStreamRender = Date.now();
  const raw = S.streaming.dataset.acc || '';
  if (S.streaming.dataset.role === 'assistant') renderMdStreaming(S.streaming, raw);
  else { S.streaming.textContent = raw; S.streaming.dataset.md = raw; }
  // Follow the tail + keep the typing indicator pinned to the bottom HERE, coalesced to
  // this frame. Doing it per streamed snapshot forced a synchronous layout (scrollHeight
  // read) on every token and was a top cause of editor-wide jank while streaming.
  if (S.typingEl) tailBody().appendChild(S.typingEl);
  stickToBottom();
}
export function scheduleStreamRender() {
  if (S.streamRaf || S.streamTimer) return; // a render is already booked
  const wait = STREAM_MD_MS - (Date.now() - S.lastStreamRender);
  if (wait <= 0) S.streamRaf = requestAnimationFrame(flushStreamRender);
  else S.streamTimer = setTimeout(() => { S.streamTimer = 0; if (!S.streamRaf) S.streamRaf = requestAnimationFrame(flushStreamRender); }, wait);
}
export function cancelStreamRender() {
  if (S.streamRaf) { cancelAnimationFrame(S.streamRaf); S.streamRaf = 0; }
  if (S.streamTimer) { clearTimeout(S.streamTimer); S.streamTimer = 0; }
}

export function wireShell() {
  if (jumpBtn) jumpBtn.addEventListener('click', scrollToLatest);
}
