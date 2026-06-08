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

export function chatHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body { font-family: var(--vscode-font-family); margin: 0; color: var(--vscode-foreground);
         background: var(--vscode-editor-background); display: flex; flex-direction: column; height: 100vh; }

  /* top platform tabs (claude code | codex) */
  #tabs { display: flex; border-bottom: 1px solid var(--vscode-panel-border); }
  .tab { padding: 10px 16px; cursor: pointer; font-size: 0.9em; opacity: 0.6;
         border-bottom: 2px solid transparent; user-select: none; }
  .tab:hover { opacity: 0.85; }
  .tab.active { opacity: 1; border-bottom-color: var(--vscode-focusBorder); }

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

  /* right chat area */
  #main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  #log { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; }
  .msg { margin: 6px 0; padding: 8px 10px; border-radius: 8px; white-space: pre-wrap; line-height: 1.4; max-width: 85%; }
  .user      { background: var(--vscode-input-background); align-self: flex-end; }
  .assistant { background: var(--vscode-editorWidget-background); align-self: flex-start; }
  .thinking  { opacity: 0.55; font-style: italic; align-self: flex-start; }
  .tool      { opacity: 0.8; font-family: var(--vscode-editor-font-family); font-size: 0.9em; align-self: flex-start; }
  .cursor::after { content: "\\u258B"; opacity: 0.6; animation: blink 1s step-end infinite; }
  @keyframes blink { 50% { opacity: 0; } }

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
  <div id="tabs">
    <div class="tab active" data-cli="claude">claude code</div>
    <div class="tab" data-cli="codex">codex</div>
  </div>
  <div id="wrap">
    <div id="sidebar">
      <h3>Sessions</h3>
      <div id="sessList"></div>
      <div id="showAll" style="display:none"></div>
      <div id="empty" style="display:none">No sessions yet.<br/>Start a chat below.</div>
      <button id="newBtn">+ New</button>
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
<script>
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
  function selectTab(next) {
    if (next === cli) return;
    cli = next;
    tabs.forEach(t => t.classList.toggle('active', t.dataset.cli === cli));
    fillModels();
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
  function bubble(role) {
    const el = document.createElement('div');
    el.className = 'msg ' + role;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function onMessage(msg) {
    if (msg.partial) {
      if (!streaming || streaming.dataset.role !== msg.role) {
        streaming = bubble(msg.role);
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
        bubble(msg.role).textContent = msg.text;
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

  window.addEventListener('message', (event) => {
    const m = event.data;
    if (m.type === 'message') onMessage(m.msg);
    else if (m.type === 'sessions') { allSessions = m.list || []; activeId = m.activeId; renderSessions(); }
    else if (m.type === 'clear') { log.innerHTML = ''; streaming = null; }
  });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
