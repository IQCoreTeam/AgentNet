// Panel module cut from the legacy webview script (issue #215). Bodies are verbatim apart from
// the S.<name> state rewrite.
import { S } from "./state.js";
import { log } from "./dom.js";
import { CHECK_ICON, COPY_ICON, copyText } from "./markdown.js";
import { scrollToLatest, stickToBottom, syncWatermark } from "./shell.js";
import { userImagesEl } from "./composer.js";

// ---- turn threads ----
// The log is a list of TURNS. A user command opens a turn (sticky header +
// timeline body); every reply until the next user command is a NODE on that
// turn's body. tailTurn/headTurn track where new replies and prepended history go.

// Open a new turn at the bottom (a fresh user command). Returns its body element.
// Build the user-message block for a turn head. A long message starts COLLAPSED
// (a few lines) with a "Show more" toggle; expanded it caps at 40vh and scrolls
// inside, so a huge paste never pushes the chat off-screen.
export function makeUtext(userText) {
  const wrap = document.createElement('div'); wrap.className = 'utextWrap';
  const ut = document.createElement('div'); ut.className = 'utext'; ut.textContent = userText;
  wrap.appendChild(ut);
  const longMsg = (userText.split('\n').length > 4) || (userText.length > 280);
  if (longMsg) {
    wrap.classList.add('collapsed');
    const tog = document.createElement('div'); tog.className = 'utextToggle'; tog.textContent = 'Show more';
    tog.addEventListener('click', () => {
      const exp = wrap.classList.toggle('expanded');
      wrap.classList.toggle('collapsed', !exp);
      tog.textContent = exp ? 'Show less' : 'Show more';
    });
    wrap.appendChild(tog);
  }
  return wrap;
}
// Engine badge text per persisted cli. Old logs can carry a cli this build does not know;
// those engines ran the codex passthrough, so their marks fall back to codex (mirrors
// core's coerceEngineKey).
export const ENGINE_BADGE = { claude: 'claude', codex: 'codex · gpt', custom: 'custom' };
export const engineMark = (c) => ENGINE_BADGE[c] ? c : 'codex';
export function startTurn(userText, badgeCli, imageInfo) {
  const turn = document.createElement('div'); turn.className = 'turn';
  const head = document.createElement('div'); head.className = 'turnHead';
  head.innerHTML = '<span class="uq">&gt;</span>';
  const ut = makeUtext(userText);
  head.appendChild(ut);
  if (badgeCli) { const b = document.createElement('span'); b.className = 'badge ' + engineMark(badgeCli);
    b.textContent = ENGINE_BADGE[engineMark(badgeCli)]; head.appendChild(b); }
  // Thumbnails go INSIDE the text column, below the text — not as a flex sibling of it in
  // turnHead. As a sibling they competed with .utext for the row's width, so two 168px
  // images starved the text down to a one-character-per-line vertical sliver. insertBefore
  // a present "Show more" toggle keeps order text -> images -> toggle (toggle is null when
  // the message is short, so this also just appends in the common case).
  const imgEl = userImagesEl(imageInfo);
  if (imgEl) ut.insertBefore(imgEl, ut.querySelector('.utextToggle'));
  const body = document.createElement('div'); body.className = 'turnBody';
  turn.appendChild(head); turn.appendChild(body);
  log.appendChild(turn);
  (turn as any)._body = body; S.tailTurn = turn;
  scrollToLatest(); // a new user command — always jump to it
  syncWatermark();
  return body;
}
// Open a turn at the TOP (prepended older history). Same shape, inserted first.
export function startTurnTop(userText, badgeCli) {
  const turn = document.createElement('div'); turn.className = 'turn';
  const head = document.createElement('div'); head.className = 'turnHead';
  head.innerHTML = '<span class="uq">&gt;</span>';
  head.appendChild(makeUtext(userText));
  if (badgeCli) { const b = document.createElement('span'); b.className = 'badge ' + engineMark(badgeCli);
    b.textContent = ENGINE_BADGE[engineMark(badgeCli)]; head.appendChild(b); }
  const body = document.createElement('div'); body.className = 'turnBody';
  turn.appendChild(head); turn.appendChild(body);
  log.insertBefore(turn, log.firstChild);
  (turn as any)._body = body; S.headTurn = turn;
  return body;
}
// The body a new BOTTOM reply attaches to. If no turn is open yet (a reply with no
// preceding user command — e.g. a resumed assistant-first history), open a headless
// turn so the timeline still renders.
export function tailBody() {
  if (S.tailTurn && S.tailTurn._body) return S.tailTurn._body;
  const turn = document.createElement('div'); turn.className = 'turn';
  const body = document.createElement('div'); body.className = 'turnBody';
  turn.appendChild(body); log.appendChild(turn); (turn as any)._body = body; S.tailTurn = turn;
  syncWatermark();
  return body;
}

// Add a reply NODE (assistant/thinking/tool/summary) to a turn body. dir: 'tail'
// = current bottom turn; 'head' = the prepended top turn.
export function appendNode(el, dir) {
  const body = dir === 'head'
    ? (S.headTurn && S.headTurn._body) || startTurnTop('', undefined)
    : tailBody();
  body.appendChild(el);
  if (dir !== 'head') stickToBottom();
}

// ---- reply bubble (an assistant/thinking text node on the current turn) ----
// prepend=true → goes on the prepended (older) head turn; else the bottom tail turn.
export function bubble(role, prepend, badgeCli) {
  const node = document.createElement('div');
  // the engine class (claude/codex/custom) tints the timeline dot into an engine mark
  node.className = 'node ' + role + (badgeCli ? ' ' + engineMark(badgeCli) : '');
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  node.appendChild(el);
  appendNode(node, prepend ? 'head' : 'tail');
  (el as any)._row = node; // node element, so callers can attach a footer / clamp toggle
  return el;
}

// Clamp a long body element behind a fade with a "show more / less" toggle.
// Used for verbose user messages and folded summaries.
export function clampBody(el, row, threshold) {
  if ((el.textContent || '').length <= threshold) return;
  el.classList.add('clamp');
  const btn = document.createElement('button');
  btn.className = 'moreBtn'; btn.textContent = 'show more';
  btn.addEventListener('click', () => {
    const on = el.classList.toggle('clamp');
    btn.textContent = on ? 'show more' : 'show less';
  });
  row.appendChild(btn);
}

// A /compact boundary: an amber rule ("CONTEXT COMPACTED") plus the summary text
// in a quiet, foldable side-barred block. role:"summary" records land here so the
// user SEES where history was condensed instead of it reading as a normal turn.
export function renderSummary(text, prepend) {
  const node = document.createElement('div'); node.className = 'node summary';
  const rule = document.createElement('div');
  rule.className = 'compactRule';
  rule.innerHTML = '<div class="ln"></div><span class="lbl">⌘ context compacted</span><div class="ln"></div>';
  const body = document.createElement('div');
  body.className = 'summaryBody';
  body.textContent = text;
  node.appendChild(rule); node.appendChild(body);
  appendNode(node, prepend ? 'head' : 'tail');
  if (!prepend) clampBody(body, body, 400);
}

// The footer under an assistant reply: elapsed time + model name (when known).
// Whole-message copy button on an assistant reply, mirroring the per-code-block
// affordance. Lives on the ROW (not inside .msg) because streaming re-renders swap
// .msg's innerHTML — a button inside it would be destroyed on every repaint.
export function addMsgCopy(row, el) {
  if (!row || row.querySelector(':scope > .msgCopy')) return;
  const btn = document.createElement('button');
  btn.className = 'msgCopy'; btn.title = 'Copy message'; btn.innerHTML = COPY_ICON;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    copyText(el.dataset.md || el.textContent || '', () => {
      btn.classList.add('done'); btn.innerHTML = CHECK_ICON;
      setTimeout(() => { btn.classList.remove('done'); btn.innerHTML = COPY_ICON; }, 1200);
    });
  });
  row.appendChild(btn);
}
export function addFooter(row, durationMs, model) {
  if (durationMs == null && !model) return;
  const f = document.createElement('div'); f.className = 'footer';
  if (durationMs != null) {
    const s = durationMs / 1000;
    f.appendChild(document.createTextNode(s < 60 ? s.toFixed(1) + 's' : Math.floor(s / 60) + 'm ' + Math.round(s % 60) + 's'));
  }
  if (model) { const m = document.createElement('span'); m.className = 'mdl'; m.textContent = model; f.appendChild(m); }
  row.appendChild(f);
}
// ---- tool / bash / diff cards ----
// Tool actions render as compact cards (a bash run, a diff, a file op) instead
// of plain text — the "what the agent actually did" view. claude sends the
// command and its output as SEPARATE messages; we merge the output into the
// open bash card so it reads like one block (codex already sends them together).
export function toolRow(prepend) {
  const row = document.createElement('div');
  row.className = 'node tool';
  appendNode(row, prepend ? 'head' : 'tail');
  return row;
}
// a 11px chevron that rotates when its card is open
export const CHEV = '<svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>';
// Make a head row toggle a body element (chevron rotates, body hides). The body
// starts collapsed for bash output (noisy), open for diffs (the point of the card).
export function makeCollapsible(head, body, startOpen) {
  head.classList.add('clickable');
  head.insertAdjacentHTML('afterbegin', CHEV);
  const set = (open) => { head.classList.toggle('open', open); body.hidden = !open; };
  set(startOpen);
  head.addEventListener('click', () => set(body.hidden));
}
export function setOutput(card, output, exitCode) {
  let out = card.querySelector('.toolOut');
  if (!out) {
    out = document.createElement('pre'); out.className = 'toolOut toolBody';
    card.appendChild(out);
    makeCollapsible(card.querySelector('.toolHead'), out, false); // bash output folds away
  }
  out.textContent = output;
  if (typeof exitCode === 'number' && exitCode !== 0) card.classList.add('failed');
}
// Render a diff into the 'pre' element, showing only ±CTX lines around each
// change and folding long unchanged runs into a "⋯" marker (OpenGUI-style). The
// +/- gutter is a fixed-width column so code lines align. Returns {added,removed}.
export function renderDiff(pre, diffText) {
  const lines = diffText.split('\n');
  const kind = lines.map((l) => (l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : 'ctx'));
  let added = 0, removed = 0;
  for (const k of kind) { if (k === 'add') added++; else if (k === 'del') removed++; }
  const CTX = 2;
  const keep = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (kind[i] === 'ctx') continue;
    for (let c = Math.max(0, i - CTX); c <= Math.min(lines.length - 1, i + CTX); c++) keep[c] = true;
  }
  let folding = false;
  for (let i = 0; i < lines.length; i++) {
    if (!keep[i]) {
      if (!folding) { folding = true; const f = document.createElement('div'); f.className = 'fold'; f.textContent = '⋯'; pre.appendChild(f); }
      continue;
    }
    folding = false;
    const d = document.createElement('div'); d.className = kind[i];
    const sign = kind[i] === 'add' ? '+' : kind[i] === 'del' ? '−' : '';
    const text = lines[i].replace(/^[+\-]/, '');
    d.innerHTML = '<span class="gut">' + sign + '</span>';
    d.appendChild(document.createTextNode(text || '\u00A0'));
    pre.appendChild(d);
  }
  return { added, removed };
}
// Build a tool card into the given .node.tool row. Shared by live render + history
// prepend. Returns the bash card if it's awaiting output (so the caller can track it).
export function renderToolInto(row, msg) {
  const t = msg.tool || {};
  if (t.command !== undefined) {
    const card = document.createElement('div'); card.className = 'toolCard bash';
    const head = document.createElement('div'); head.className = 'toolHead';
    head.innerHTML = '<span class="tk">$</span>';
    const cmd = document.createElement('span'); cmd.className = 'cmd'; cmd.textContent = t.command;
    head.appendChild(cmd); card.appendChild(head);
    if (t.output) setOutput(card, t.output, t.exitCode);
    row.appendChild(card);
    return t.output ? null : card; // no output yet → caller may fold a later result in
  } else if (t.diff !== undefined) {
    const card = document.createElement('div'); card.className = 'toolCard diff';
    const head = document.createElement('div'); head.className = 'toolHead';
    head.innerHTML = '<span class="tk">✎</span>';
    const fn = document.createElement('span'); fn.className = 'file'; fn.textContent = t.file || 'edit';
    head.appendChild(fn);
    card.appendChild(head);
    const pre = document.createElement('pre'); pre.className = 'diffBody toolBody';
    const { added, removed } = renderDiff(pre, t.diff);
    const stat = document.createElement('span'); stat.className = 'stat';
    stat.innerHTML = '<span class="plus">+' + added + '</span><span class="minus">−' + removed + '</span>';
    head.appendChild(stat);
    card.appendChild(pre);
    makeCollapsible(head, pre, true);
    row.appendChild(card);
  } else {
    const card = document.createElement('div'); card.className = 'toolCard op';
    const icon = t.name === 'Read' ? '<svg class="anic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h7l5 5v13H6Z"/><path d="M13 3v5h5"/><path d="M9 13h6M9 16.5h6"/></svg>' : t.name === 'Write' ? '✎' : '•';
    card.innerHTML = '<span class="icon">' + icon + '</span>';
    card.appendChild(document.createTextNode(msg.text || t.name || 'tool'));
    row.appendChild(card);
  }
  return null;
}
export function renderTool(msg, prepend) {
  const t = msg.tool || {};
  // output-only result (claude) → fold into the open bash card
  if (t.command === undefined && t.diff === undefined && t.output && S.openBash && !prepend) {
    setOutput(S.openBash, t.output, t.exitCode);
    S.openBash = null;
    return;
  }
  const row = toolRow(prepend);
  const awaiting = renderToolInto(row, msg);
  if (awaiting) S.openBash = awaiting; // bash card waiting for its result message
  if (!prepend) { if (S.typingEl) tailBody().appendChild(S.typingEl); stickToBottom(); }
}
