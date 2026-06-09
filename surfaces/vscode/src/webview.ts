// Chat webview (HTML + inline JS). VSCode standard postMessage pattern.
//   input  -> vscode.postMessage({type:"send"})            (user -> extension)
//   render <- extension.postMessage({type:"message"|...})  (CLI output -> panel)
//
// Layout follows the codex panel reference (visual only — its code is closed):
//   top    = Platform tabs (claude code | codex)  -> postMessage {type:"platform"}
//   left   = session list: title + relative time, "모두 보기(N)" when long
//   bottom = model dropdown + input
//
// Typing effect via the contract's `partial` flag:
//   partial:true  -> append the delta to the CURRENT bubble (streaming)
//   partial:false -> that bubble is complete (start a new one next time)

import { AVATAR_SVG, AVATAR_SCRIPT } from "./avatar.js";

export function chatHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body { font-family: var(--vscode-font-family); margin: 0; color: var(--vscode-foreground);
         background: var(--vscode-editor-background); display: flex; flex-direction: column; height: 100vh; }

  /* chat / wallet panels (wallet entered via the bottom-left card, not a top tab) */
  .panel { flex: 1; display: flex; flex-direction: column; min-height: 0; }

  /* wallet/skills pages */
  .page { max-width: 520px; margin: 0 auto; padding: 28px 20px; width: 100%; box-sizing: border-box; }
  .page h2 { margin: 0 0 16px; font-size: 1.25em; }
  .card { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border);
          border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; }
  .card.center { text-align: center; display: flex; flex-direction: column; gap: 8px; padding: 28px; align-items: center; }
  #wAvatarBig { width: 44px; height: 44px; border-radius: 50%; overflow: hidden;
                background: var(--vscode-editor-background); margin-bottom: 4px; }
  #wAvatarBig svg { display: block; width: 100%; height: 100%; }
  .muted { opacity: 0.55; font-size: 0.85em; margin-bottom: 4px; }
  .small { font-size: 0.8em; margin-top: 8px; }
  #walletAddr { font-family: var(--vscode-editor-font-family); font-size: 0.9em; word-break: break-all; }
  .danger { width: 100%; margin-top: 4px; background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
            color: var(--vscode-foreground); border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100); }
  .danger:hover { filter: brightness(1.15); }

  /* top platform tabs (claude code | codex) + storage pill on the right */
  #tabs { display: flex; align-items: center; border-bottom: 1px solid var(--vscode-panel-border); }
  .tab { padding: 10px 16px; cursor: pointer; font-size: 0.9em; opacity: 0.6;
         border-bottom: 2px solid transparent; user-select: none; }
  .tab:hover { opacity: 0.85; }
  .tab.active { opacity: 1; border-bottom-color: var(--vscode-focusBorder); }
  #storagePill { margin-left: auto; padding: 0 12px; display: flex; align-items: center; gap: 5px;
                 font-size: 0.8em; opacity: 0.85; }
  #storagePill .dot { font-size: 0.7em; }
  #storagePill .dot.local { color: var(--vscode-testing-iconPassed, #3a3); }
  #storagePill .dot.cloud-on { color: var(--vscode-testing-iconPassed, #3a3); }
  #storagePill .dot.cloud-off { color: var(--vscode-disabledForeground, #888); }
  #storagePill .sep { opacity: 0.4; }
  #storagePill .acct { opacity: 0.5; }
  #storagePill .link { background: none; border: none; padding: 0 2px; width: auto;
                       color: var(--vscode-textLink-foreground); cursor: pointer; font-size: 1em; }
  #storagePill .link:hover { text-decoration: underline; }
  #cloudSync { font-size: 0.92em; }
  #cloudSync.ok { color: var(--vscode-testing-iconPassed, #3a3); }
  #cloudSync.err { color: var(--vscode-errorForeground, #e55); cursor: help; }

  #wrap { flex: 1; display: flex; min-height: 0; }

  /* left session list */
  #sidebar { width: 230px; border-right: 1px solid var(--vscode-panel-border);
             display: flex; flex-direction: column; overflow-y: auto; }
  #sidebar h3 { font-size: 0.75em; opacity: 0.6; padding: 10px 12px 4px; margin: 0; text-transform: uppercase; }
  .sess { display: flex; justify-content: space-between; gap: 8px; align-items: baseline;
          padding: 8px 12px; cursor: pointer; font-size: 0.9em; border-left: 2px solid transparent; }
  .sess:hover { background: var(--vscode-list-hoverBackground); }
  .sess.active { background: var(--vscode-list-activeSelectionBackground); border-left-color: var(--vscode-focusBorder); }
  .sess .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .sess .time { opacity: 0.5; font-size: 0.85em; white-space: nowrap; }
  .sess .del { opacity: 0; font-size: 0.9em; padding: 0 2px; border-radius: 3px; }
  .sess:hover .del { opacity: 0.5; }
  .sess .del:hover { opacity: 1; background: var(--vscode-inputValidation-errorBackground); }
  #showAll { padding: 8px 12px; cursor: pointer; font-size: 0.85em; opacity: 0.6; }
  #showAll:hover { opacity: 1; }
  #empty { opacity: 0.4; text-align: center; padding: 24px 12px; font-size: 0.85em; }
  #newBtn { margin: 8px 12px; }

  /* sessions scroll; wallet card pinned to the BOTTOM of the sidebar */
  #sessScroll { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
  /* the wallet = the agent. always visible, bottom-left, "this is mine" */
  #walletCard { border-top: 1px solid var(--vscode-panel-border); padding: 10px 12px;
                display: flex; align-items: center; gap: 9px; cursor: pointer;
                background: var(--vscode-editorWidget-background); user-select: none; }
  #walletCard:hover { background: var(--vscode-list-hoverBackground); }
  #walletCard.active { border-top-color: var(--vscode-focusBorder);
                       box-shadow: inset 2px 0 0 var(--vscode-focusBorder); }
  #wAvatar { width: 24px; height: 24px; border-radius: 50%; flex: none; overflow: hidden;
             background: var(--vscode-editor-background); }
  #wAvatar svg { display: block; width: 100%; height: 100%; }
  #wMeta { min-width: 0; flex: 1; }
  #wName { font-size: 0.86em; font-weight: 600; }
  #wAddr { font-size: 0.74em; opacity: 0.55; font-family: var(--vscode-editor-font-family);
           overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #wCaret { opacity: 0.4; font-size: 0.7em; }

  /* right chat area */
  #main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  #log { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; }

  /* a row = bubble (+ optional badge under it). The ROW owns left/right alignment;
     the bubble just sizes to its content. (Was: bubble used align-self, which broke
     once it got wrapped in a row.) */
  .msgRow { display: flex; flex-direction: column; max-width: 85%; }
  .msgRow.user { align-self: flex-end; align-items: flex-end; }
  .msgRow.assistant, .msgRow.thinking, .msgRow.tool { align-self: flex-start; align-items: flex-start; }
  .msg { margin: 6px 0; padding: 9px 13px; border-radius: 16px; white-space: pre-wrap; line-height: 1.45; }
  /* chat-bubble feel: round, with the "tail" corner slightly tucked */
  .msgRow.user .msg      { border-bottom-right-radius: 5px; }
  .msgRow.assistant .msg { border-bottom-left-radius: 5px; }
  .user      { background: var(--vscode-input-background); }
  .assistant { background: var(--vscode-editorWidget-background); }
  .thinking  { opacity: 0.55; font-style: italic; }
  .tool      { opacity: 0.8; font-family: var(--vscode-editor-font-family); font-size: 0.9em; }
  .cursor::after { content: "\\u258B"; opacity: 0.6; animation: blink 1s step-end infinite; }
  @keyframes blink { 50% { opacity: 0; } }

  /* platform badge chip under an assistant bubble */
  .badge { font-size: 0.66em; opacity: 0.7; margin: -2px 2px 4px; padding: 1px 7px;
           border-radius: 10px; font-weight: 600; letter-spacing: 0.02em;
           border: 1px solid transparent; }
  .badge.claude { color: #e9883a; border-color: #e9883a55; background: #e9883a18; }
  .badge.codex  { color: #3ac07a; border-color: #3ac07a55; background: #3ac07a18; }

  #controls { display: flex; gap: 8px; align-items: center; padding: 6px 10px;
              border-top: 1px solid var(--vscode-panel-border); font-size: 0.85em; }
  #controls label { opacity: 0.6; }
  #model { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground);
           border: 1px solid var(--vscode-dropdown-border); border-radius: 4px; padding: 3px 6px; }
  #bar { display: flex; gap: 6px; padding: 10px; border-top: 1px solid var(--vscode-panel-border); }
  #input { flex: 1; padding: 8px; background: var(--vscode-input-background);
           color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
           border-radius: 6px; resize: none; font-family: inherit; }
  button { padding: 8px 14px; background: var(--vscode-button-background);
           color: var(--vscode-button-foreground); border: none; border-radius: 6px; cursor: pointer; }
</style>
</head>
<body>
  <!-- No top tab bar: the wallet card (bottom-left) is the entry to My Wallet. -->

  <!-- CHAT view -->
  <div id="chatView" class="panel">
  <div id="tabs">
    <div class="tab active" data-cli="claude">claude code</div>
    <div class="tab" data-cli="codex">codex</div>
    <div id="storagePill" title="Where sessions are saved">
      <span class="dot local">●</span><span>Local</span>
      <span class="sep">·</span>
      <span id="cloudState"></span>
      <button id="cloudBtn" class="link"></button>
      <span id="cloudSync" title="Drive sync status"></span>
    </div>
  </div>
  <div id="wrap">
    <div id="sidebar">
      <div id="sessScroll">
        <h3>Sessions</h3>
        <div id="sessList"></div>
        <div id="showAll" style="display:none"></div>
        <div id="empty" style="display:none">No sessions yet.<br/>Start a chat below.</div>
        <button id="newBtn">+ New</button>
      </div>
      <!-- wallet = agent: pinned bottom-left, always visible -->
      <div id="walletCard" title="My Wallet">
        <div id="wAvatar"></div>
        <div id="wMeta">
          <div id="wName">My Wallet</div>
          <div id="wAddr">connecting…</div>
        </div>
        <span id="wCaret">▸</span>
      </div>
    </div>
    <div id="main">
      <div id="log"></div>
      <div id="controls">
        <label>Model</label>
        <select id="model"></select>
      </div>
      <div id="bar">
        <textarea id="input" rows="1" placeholder="Message claude/codex... (Enter to send)"></textarea>
        <button id="send">Send</button>
      </div>
    </div>
  </div>
  </div><!-- /chatView -->

  <!-- MY WALLET view (Skills now lives INSIDE here) -->
  <div id="walletView" class="panel" style="display:none">
    <div class="page">
      <div id="backToChat" class="muted" style="cursor:pointer;margin-bottom:10px">‹ Back to chat</div>
      <div class="card center">
        <div id="wAvatarBig"></div>
        <div class="addr" id="walletAddr">…</div>
        <div class="muted small" style="margin-top:0">This wallet is your agent.</div>
      </div>
      <div class="card">
        <div class="muted">Storage</div>
        <div id="walletStorage">…</div>
      </div>
      <div class="card">
        <div class="muted">Skills</div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:4px">
          <div style="font-size:1.6em">🧩</div>
          <div>
            <div>On-chain skills are coming soon.</div>
            <div class="muted small" style="margin-top:2px">Buy, equip, and collect agent skills (Token-2022, soulbound). Not live yet.</div>
          </div>
        </div>
      </div>
      <button class="danger" id="disconnectWalletBtn">Disconnect wallet</button>
      <div class="muted small">Disconnecting returns you to the connect screen. Your encrypted local sessions stay on this device.</div>
    </div>
  </div>
<script>
  const AVATAR_SVG = ${JSON.stringify(AVATAR_SVG)};
  ${AVATAR_SCRIPT}
  const vscode = acquireVsCodeApi();
  const log = document.getElementById('log');
  const input = document.getElementById('input');
  const sessList = document.getElementById('sessList');
  const showAll = document.getElementById('showAll');
  const emptyEl = document.getElementById('empty');
  const modelSel = document.getElementById('model');
  const tabs = Array.from(document.querySelectorAll('.tab'));

  let streaming = null;     // bubble currently being streamed into
  let allSessions = [];     // last sessions payload from extension
  let activeId = null;
  let expanded = false;     // "모두 보기" toggled?
  const COLLAPSED = 5;      // sessions shown before "모두 보기(N)"

  // Platform = which CLI. Model = the actual model inside it.
  // value 'default' = pass no --model (CLI's own default); label shows WHICH model
  // that currently is, so the user knows what 'default' resolves to. We're just a
  // wrapper — when a CLI ships a new default, only this label needs updating.
  const MODELS = {
    claude: [
      { value: 'default', label: 'default (Opus 4.8)' },
      { value: 'opus',    label: 'opus' },
      { value: 'sonnet',  label: 'sonnet' },
      { value: 'haiku',   label: 'haiku' },
    ],
    codex: [
      { value: 'default',      label: 'default (gpt-5-codex)' },
      { value: 'gpt-5',        label: 'gpt-5' },
      { value: 'gpt-5-codex',  label: 'gpt-5-codex' },
      { value: 'o3',           label: 'o3' },
    ],
  };
  let cli = 'claude';

  // ---- platform tabs + model dropdown ----
  function fillModels() {
    modelSel.innerHTML = '';
    for (const m of (MODELS[cli] || [{ value: 'default', label: 'default' }])) {
      const o = document.createElement('option');
      o.value = m.value; o.textContent = m.label;
      modelSel.appendChild(o);
    }
  }
  function setTab(next) {
    if (next !== 'claude' && next !== 'codex') return;
    cli = next;
    tabs.forEach(t => t.classList.toggle('active', t.dataset.cli === cli));
    fillModels();
  }
  function selectTab(next) {
    if (next === cli) return;
    setTab(next);
    vscode.postMessage({ type: 'platform', cli });
    vscode.postMessage({ type: 'model', model: modelSel.value });
  }
  tabs.forEach(t => t.addEventListener('click', () => selectTab(t.dataset.cli)));
  modelSel.addEventListener('change', () => vscode.postMessage({ type: 'model', model: modelSel.value }));
  fillModels();

  // ---- relative time ("3개월", "1일", "방금") ----
  function rel(ts) {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return '방금';
    const m = s / 60; if (m < 60) return Math.floor(m) + '분';
    const h = m / 60; if (h < 24) return Math.floor(h) + '시간';
    const d = h / 24; if (d < 30) return Math.floor(d) + '일';
    const mo = d / 30; if (mo < 12) return Math.floor(mo) + '개월';
    return Math.floor(mo / 12) + '년';
  }

  // ---- chat bubbles ----
  // Each message is a row (bubble + optional platform badge). prepend=true inserts
  // at the TOP (older messages on scroll-up) and does NOT auto-scroll.
  // badgeCli (claude|codex) shows a chip under assistant replies so you can tell
  // WHICH engine answered — essential once a session is continued across CLIs.
  function bubble(role, prepend, badgeCli) {
    const row = document.createElement('div');
    row.className = 'msgRow ' + role;
    const el = document.createElement('div');
    el.className = 'msg ' + role;
    row.appendChild(el);
    if (badgeCli && (role === 'assistant')) {
      const b = document.createElement('div');
      b.className = 'badge ' + badgeCli;
      b.textContent = badgeCli === 'codex' ? 'codex · gpt' : 'claude';
      row.appendChild(b);
    }
    if (prepend) log.insertBefore(row, log.firstChild);
    else { log.appendChild(row); log.scrollTop = log.scrollHeight; }
    return el;
  }
  function onMessage(msg) {
    // Badge = the engine that ACTUALLY produced this message (msg.cli, stamped by
    // the runtime). NO fallback to the current tab — if a message has no cli (old
    // session saved before per-message cli), we show no badge rather than a wrong,
    // tab-following one. So badges never flip when you switch tabs.
    const badge = (msg.role === 'assistant' && msg.cli) ? msg.cli : undefined;
    if (msg.partial) {
      if (!streaming || streaming.dataset.role !== msg.role) {
        streaming = bubble(msg.role, false, badge);
        streaming.dataset.role = msg.role;
        streaming.classList.add('cursor');
      }
      streaming.textContent += msg.text;
    } else {
      if (streaming && streaming.dataset.role === msg.role) {
        streaming.textContent += msg.text;
        streaming.classList.remove('cursor');
        streaming = null;
      } else {
        bubble(msg.role, false, badge).textContent = msg.text;
      }
    }
    log.scrollTop = log.scrollHeight;
  }

  // ---- session list (title + relative time + 모두 보기) ----
  function renderSessions() {
    sessList.innerHTML = '';
    emptyEl.style.display = allSessions.length ? 'none' : 'block';
    const shown = expanded ? allSessions : allSessions.slice(0, COLLAPSED);
    for (const s of shown) {
      const el = document.createElement('div');
      el.className = 'sess' + (s.sessionId === activeId ? ' active' : '');
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = s.title || '(untitled)';
      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = rel(s.ts);
      const del = document.createElement('span');
      del.className = 'del';
      del.textContent = '\\u2715'; // x mark
      del.title = 'Delete session';
      del.onclick = (e) => {
        e.stopPropagation(); // don't trigger the row's open
        vscode.postMessage({ type: 'delete', sessionId: s.sessionId });
      };
      el.appendChild(title); el.appendChild(time); el.appendChild(del);
      // cross-CLI: clicking opens the session in the CURRENT tab's cli, so we no
      // longer send the session's own cli (the extension ignores it).
      el.onclick = () => vscode.postMessage({ type: 'open', sessionId: s.sessionId });
      sessList.appendChild(el);
    }
    if (allSessions.length > COLLAPSED) {
      showAll.style.display = 'block';
      showAll.textContent = expanded ? '접기' : '모두 보기(' + allSessions.length + ')';
    } else {
      showAll.style.display = 'none';
    }
  }
  showAll.addEventListener('click', () => { expanded = !expanded; renderSessions(); });

  // ---- input ----
  function send() {
    const text = input.value.trim();
    if (!text) return;
    vscode.postMessage({ type: 'send', text });
    input.value = '';
  }
  document.getElementById('send').addEventListener('click', send);
  document.getElementById('newBtn').addEventListener('click', () => vscode.postMessage({ type: 'new' }));
  input.addEventListener('keydown', (e) => {
    // e.isComposing = IME (Korean/Japanese/Chinese) mid-composition; don't send
    // a half-formed syllable. keyCode 229 is the legacy IME-in-progress signal.
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  // ---- storage pill (Local always on; Cloud optional mirror) ----
  const cloudState = document.getElementById('cloudState');
  const cloudBtn = document.getElementById('cloudBtn');
  let storageOptions = [];
  let cloudConnected = false;

  function renderStorage(info, options) {
    storageOptions = options || storageOptions;
    cloudConnected = !!(info && info.connected);
    if (cloudConnected) {
      const label = (info.kind === 'gdrive' ? 'Google Drive'
                  : info.kind === 'icloud' ? 'iCloud'
                  : info.kind === 'custom' ? 'Cloud' : info.kind);
      // label links to the provider (gdrive opens drive.google.com); account
      // (the signed-in email) shows in muted text after it.
      const linkable = info.kind === 'gdrive';
      const acct = info.account ? ' <span class="acct">(' + info.account + ')</span>' : '';
      cloudState.innerHTML = '<span class="dot cloud-on">●</span>'
        + (linkable ? '<a href="#" id="cloudLink" class="link">' + label + '</a>' : label)
        + acct;
      const link = document.getElementById('cloudLink');
      if (link) link.addEventListener('click', (e) => {
        e.preventDefault();
        vscode.postMessage({ type: 'openCloud', kind: info.kind });
      });
      cloudBtn.textContent = 'disconnect';
    } else {
      cloudState.innerHTML = '<span class="dot cloud-off">●</span>No cloud';
      cloudBtn.textContent = 'connect';
    }
  }

  // connect = pick from a tiny prompt list; disconnect = turn the mirror off.
  cloudBtn.addEventListener('click', () => {
    if (cloudConnected) { vscode.postMessage({ type: 'disconnectCloud' }); return; }
    vscode.postMessage({ type: 'pickCloud' }); // extension shows a native quick-pick
  });

  // ---- view switcher: Chat <-> My Wallet (the wallet card is the entry) ----
  const panels = {
    chat: document.getElementById('chatView'),
    wallet: document.getElementById('walletView'),
  };
  const walletCard = document.getElementById('walletCard');
  function showView(name) {
    for (const k in panels) panels[k].style.display = (k === name) ? 'flex' : 'none';
    walletCard.classList.toggle('active', name === 'wallet');
    if (name === 'wallet') vscode.postMessage({ type: 'wallet' }); // refresh address
  }
  walletCard.addEventListener('click', () => showView('wallet'));
  document.getElementById('backToChat').addEventListener('click', () => showView('chat'));

  // Fill BOTH the bottom-left card and the full wallet page from one address.
  // Card shows "My Wallet (wdf..ere)"; the page shows the full address.
  function short(a) { return a && a.length > 10 ? a.slice(0, 4) + '..' + a.slice(-3) : a; }
  function setWallet(address) {
    const full = address || '(not connected)';
    document.getElementById('walletAddr').textContent = full;
    document.getElementById('wAddr').textContent = address ? short(address) : 'not connected';
    document.getElementById('wName').textContent = address ? 'My Wallet (' + short(address) + ')' : 'My Wallet';
    // wallet-seeded character avatar (ported from solchat); same address = same face
    const svg = address ? avatarSvg(address) : '';
    document.getElementById('wAvatar').innerHTML = svg;
    document.getElementById('wAvatarBig').innerHTML = svg;
  }

  // Drive sync indicator next to the pill: ✓ synced / ⚠ failed (hover = why).
  function renderCloudSync(status) {
    const el = document.getElementById('cloudSync');
    if (!el) return;
    if (!status || !cloudConnected) { el.textContent = ''; el.className = ''; el.title = ''; return; }
    if (status.ok) { el.textContent = '✓'; el.className = 'ok'; el.title = 'Synced to Drive'; }
    else { el.textContent = '⚠'; el.className = 'err'; el.title = 'Drive sync failed: ' + (status.error || 'unknown'); }
  }

  // My Wallet: storage summary mirrors the pill; address comes from the extension.
  function renderWalletStorage() {
    const el = document.getElementById('walletStorage');
    el.textContent = cloudConnected ? 'Local + cloud mirror (connected)' : 'Local only (no cloud)';
  }
  document.getElementById('disconnectWalletBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'disconnectWallet' });
  });

  // ---- scroll-to-top → load older page ----
  let pageCursor = null;   // cursor for the NEXT older page (null = none / at start)
  let hasMore = false;     // older pages exist?
  let loadingOlder = false;
  function resetPaging() { pageCursor = null; hasMore = false; loadingOlder = false; }

  // Prepend older messages while keeping the viewport pinned (no jump): measure
  // scroll height before/after and restore the offset.
  function prependOlder(messages) {
    const before = log.scrollHeight;
    for (let i = messages.length - 1; i >= 0; i--) bubble(messages[i].role, true).textContent = messages[i].text;
    log.scrollTop += log.scrollHeight - before;
  }

  log.addEventListener('scroll', () => {
    if (log.scrollTop <= 8 && hasMore && !loadingOlder && pageCursor !== null) {
      loadingOlder = true;
      vscode.postMessage({ type: 'loadMore', cursor: pageCursor });
    }
  });

  window.addEventListener('message', (event) => {
    const m = event.data;
    if (m.type === 'message') onMessage(m.msg);
    else if (m.type === 'sessions') { allSessions = m.list || []; activeId = m.activeId; renderSessions(); }
    else if (m.type === 'clear') { log.innerHTML = ''; streaming = null; resetPaging(); }
    else if (m.type === 'platform') setTab(m.cli); // extension switched CLI (e.g. on session open)
    else if (m.type === 'storage') { renderStorage(m.info, m.options); renderWalletStorage(); }
    else if (m.type === 'cloudSync') renderCloudSync(m.status);
    else if (m.type === 'wallet') setWallet(m.address);
    else if (m.type === 'page') { hasMore = m.hasMore; pageCursor = m.cursor; }
    else if (m.type === 'older') {
      prependOlder(m.messages || []);
      hasMore = m.hasMore; pageCursor = m.cursor; loadingOlder = false;
    }
  });

  vscode.postMessage({ type: 'ready' });
  vscode.postMessage({ type: 'wallet' }); // fill the bottom-left wallet card on load
</script>
</body>
</html>`;
}
