// AgentNet activity-bar sidebar (VS Code WebviewView): a session-list HOME.
//
// This is a SEPARATE, lightweight webview from the chat panel (chatHtml). It shows the
// wallet strip + drive chip, a single "New session" action, search, and the recent-chats
// list with a live per-session RUNNING marker. It never runs its own engine: it reads the
// session list the host forwards (the same {type:'sessions'} frame the chat panel emits,
// carrying `running` off the core's `busy` set) and routes clicks back to the host.
//
// Protocol (webview <-> host):
//   in : { type:'sessions', list, activeId, running, cloud }
//        { type:'wallet', address } | { type:'storage', connected, label }
//        { type:'onboard', value:boolean }
//   out: { type:'ready' } | { type:'open', sessionId } | { type:'new' }
//        { type:'delete', sessionId } | { type:'drive' } | { type:'wallet' }
export function sidebarHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; background: #101114; color: #e7e7ea;
         font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
         display: flex; flex-direction: column; overflow: hidden; }
  .whead { display: flex; align-items: center; gap: 8px; padding: 13px 13px 9px; }
  .wm { font-size: 11px; font-weight: 700; letter-spacing: 2.4px; color: #e7e7ea; }
  .wline { display: flex; align-items: center; gap: 7px; padding: 0 13px 12px; cursor: pointer; }
  .wline:hover .waddr { color: #ffffff; }
  .wdia { font-size: 10px; color: #6f717b; }
  .waddr { font-size: 10.5px; color: #c7c8d0; letter-spacing: 0.4px; }
  .grow { flex: 1; }
  .drive { position: relative; display: inline-flex; align-items: center; gap: 5px;
           font-size: 8.5px; font-weight: 700; letter-spacing: 0.4px; color: #5aa392;
           cursor: pointer; padding: 3px 5px; max-width: 150px; }
  .drive .lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .drive::after { content: ''; position: absolute; left: 5px; right: 100%; bottom: 1px;
                  border-bottom: 1px solid #7af0dc; transition: right 0.16s cubic-bezier(0.05,0.7,0.1,1); }
  .drive:hover::after { right: 5px; }
  .drive:hover { color: #7af0dc; }
  .drive:hover .swp { transform: rotate(180deg); }
  .drive .swp { transition: transform 0.2s; display: inline-flex; }
  .drive.off { color: #6f717b; letter-spacing: 0.8px; }
  .drive.off::after { border-bottom-color: #e7e7ea; }
  .drive.off:hover { color: #e7e7ea; }
  .drive.off:hover .swp { transform: translateX(2px); }
  .cloud { width: 12px; height: 12px; flex: none; }
  .newbtn { display: flex; align-items: center; justify-content: center; gap: 7px; height: 30px;
            margin: 0 13px; color: #e7e7ea; font-size: 10px; font-weight: 700; letter-spacing: 1.4px;
            border: 1px solid #3a3b44; background: rgba(255,255,255,0.03);
            clip-path: polygon(0 0, calc(100% - 9px) 0, 100% 9px, 100% 100%, 0 100%); cursor: pointer; }
  .newbtn:hover { border-color: #5a5b66; background: rgba(255,255,255,0.06); }
  .plus { font-size: 14px; font-weight: 400; line-height: 0; }
  .search { display: flex; align-items: center; gap: 8px; height: 28px; margin: 13px 13px 8px;
            padding: 0 10px; border: 1px solid #23242b; background: #0b0c0f; }
  .scur { font-size: 10px; font-weight: 700; color: #4d8f80; }
  .search input { flex: 1; min-width: 0; background: transparent; border: 0; outline: 0;
                  color: #d8d8d8; font-family: inherit; font-size: 10px; letter-spacing: 0.3px; padding: 0; }
  .search input::placeholder { color: #56585f; }
  .list { flex: 1; display: flex; flex-direction: column; padding: 2px 7px 12px; overflow-y: auto; }
  .srow { position: relative; display: flex; align-items: center; gap: 8px; height: 33px;
          padding: 0 8px 0 12px; cursor: pointer; border: 1px solid transparent; border-radius: 3px; }
  .srow:hover { background: #17181d; }
  .srow.on { background: #191a20; }
  .sfocus { position: absolute; inset: 1px; display: none; pointer-events: none; color: #e7e7ea; }
  .srow.on .sfocus { display: block; }
  .sfocus::before { content: ''; position: absolute; top: 0; left: 0; width: 7px; height: 7px;
                    border-top: 1.5px solid currentColor; border-left: 1.5px solid currentColor; }
  .sfocus::after { content: ''; position: absolute; bottom: 0; right: 0; width: 7px; height: 7px;
                   border-bottom: 1.5px solid currentColor; border-right: 1.5px solid currentColor; }
  .sfocus .c2::before { content: ''; position: absolute; top: 0; right: 0; width: 7px; height: 7px;
                        border-top: 1.5px solid currentColor; border-right: 1.5px solid currentColor; }
  .sfocus .c2::after { content: ''; position: absolute; bottom: 0; left: 0; width: 7px; height: 7px;
                       border-bottom: 1.5px solid currentColor; border-left: 1.5px solid currentColor; }
  .spin { font-size: 11px; color: #5fe6cf; flex: none; width: 10px; text-align: center; }
  .stitle { font-size: 10.5px; font-weight: 600; letter-spacing: 0.1px; white-space: nowrap;
            overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1; color: #c7c8d0; }
  .run { font-size: 8px; font-weight: 700; letter-spacing: 1px; color: #5aa392; flex: none; }
  .run .dots { display: inline-block; width: 14px; text-align: left; }
  .stime { font-size: 9px; font-weight: 700; letter-spacing: 0.4px; color: #63656e; flex: none; }
  .del { display: none; align-items: center; justify-content: center; width: 19px; height: 19px;
         border-radius: 3px; color: #6f717b; flex: none; }
  .del:hover { color: #f6764f; background: rgba(241,90,57,0.1); }
  .srow:hover .stime, .srow.on .stime { display: none; }
  .srow:hover .del, .srow.on .del { display: inline-flex; }
  .empty { padding: 22px 16px; text-align: center; font-size: 9.5px; line-height: 1.6; color: #7c7e88; }
  .cta { display: flex; align-items: center; justify-content: center; height: 30px; margin: 8px 13px;
         border: 1px solid #3a3b44; background: rgba(255,255,255,0.03); color: #e7e7ea;
         font-size: 10px; font-weight: 700; letter-spacing: 1.2px; cursor: pointer;
         clip-path: polygon(0 0, calc(100% - 9px) 0, 100% 9px, 100% 100%, 0 100%); }
  .warn { padding: 4px 10px; font-size: 9px; color: #e5c07b; opacity: 0.9; }
  .hidden { display: none !important; }
</style>
</head>
<body>
  <div class="whead"><span class="wm">AGENTNET</span></div>
  <div class="wline" id="walletStrip">
    <span class="wdia">&#9670;</span>
    <span class="waddr" id="waddr">connecting...</span>
    <span class="grow"></span>
    <span class="drive off" id="driveChip" title="Storage"><svg class="cloud" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4.5 12.5a3 3 0 0 1-.3-6 3.8 3.8 0 0 1 7.4-.8 2.8 2.8 0 0 1-.4 5.6z"></path></svg><span class="lbl">LOCAL</span></span>
  </div>
  <div class="newbtn" id="newBtn"><span class="plus">+</span> NEW SESSION</div>
  <div class="search"><span class="scur">&gt;</span><input id="search" placeholder="search sessions..." autocomplete="off" spellcheck="false" /></div>
  <div class="warn hidden" id="warn"></div>
  <div class="list" id="list"></div>
  <div class="empty hidden" id="empty">No chats yet.<br />Start one below.</div>
  <div class="cta hidden" id="onboard">GET STARTED</div>

<script>
(function () {
  var vscode = acquireVsCodeApi();
  var sessions = [];
  var activeId = null;
  var running = {};       // sessionId -> true
  var runningCount = 0;
  var filter = '';
  var spinTimer = null;
  var tick = 0;
  var SPIN = ['|', '/', '-', '\\\\'];

  var listEl = document.getElementById('list');
  var emptyEl = document.getElementById('empty');
  var warnEl = document.getElementById('warn');
  var searchEl = document.getElementById('search');
  var onboardEl = document.getElementById('onboard');

  function rel(ts) {
    var s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return 'now';
    var m = s / 60; if (m < 60) return Math.floor(m) + 'm';
    var h = m / 60; if (h < 24) return Math.floor(h) + 'h';
    var d = h / 24; if (d < 30) return Math.floor(d) + 'd';
    var mo = d / 30; if (mo < 12) return Math.floor(mo) + 'mo';
    return Math.floor(mo / 12) + 'y';
  }

  function svgTrash() {
    return '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 4.5h10M6.3 4.5V3h3.4v1.5M4.6 4.5l.5 8.5h5.8l.5-8.5"></path></svg>';
  }

  function ensureSpin() {
    if (runningCount > 0 && !spinTimer) {
      spinTimer = setInterval(function () {
        tick++;
        var g = SPIN[tick % 4];
        var dots = new Array(1 + (tick % 3) + 1).join('.');
        var spins = document.getElementsByClassName('spin');
        for (var i = 0; i < spins.length; i++) spins[i].textContent = g;
        var dd = document.getElementsByClassName('dots');
        for (var j = 0; j < dd.length; j++) dd[j].textContent = dots;
      }, 220);
    } else if (runningCount === 0 && spinTimer) {
      clearInterval(spinTimer); spinTimer = null;
    }
  }

  function render() {
    listEl.textContent = '';
    var q = filter.trim().toLowerCase();
    var shown = q ? sessions.filter(function (s) { return (s.title || '').toLowerCase().indexOf(q) >= 0; }) : sessions;
    emptyEl.classList.toggle('hidden', sessions.length !== 0);
    for (var i = 0; i < shown.length; i++) {
      (function (s) {
        var isRun = !!running[s.sessionId];
        var row = document.createElement('div');
        row.className = 'srow' + (s.sessionId === activeId ? ' on' : '');

        var focus = document.createElement('span');
        focus.className = 'sfocus';
        var c2 = document.createElement('span');
        c2.className = 'c2';
        c2.style.cssText = 'position:absolute;inset:0;';
        focus.appendChild(c2);
        row.appendChild(focus);

        if (isRun) {
          var sp = document.createElement('span');
          sp.className = 'spin';
          sp.textContent = SPIN[tick % 4];
          row.appendChild(sp);
        }

        var title = document.createElement('span');
        title.className = 'stitle';
        title.textContent = s.title || '(untitled)';
        if (isRun) title.style.color = '#d9fff6';
        else if (s.sessionId === activeId) title.style.color = '#ffffff';
        row.appendChild(title);

        if (isRun) {
          var run = document.createElement('span');
          run.className = 'run';
          run.appendChild(document.createTextNode('RUN'));
          var dots = document.createElement('span');
          dots.className = 'dots';
          dots.textContent = '.';
          run.appendChild(dots);
          row.appendChild(run);
        } else {
          var time = document.createElement('span');
          time.className = 'stime';
          time.textContent = rel(s.ts);
          row.appendChild(time);
        }

        var del = document.createElement('span');
        del.className = 'del';
        del.title = 'Delete';
        del.innerHTML = svgTrash();
        del.onclick = function (e) {
          e.stopPropagation();
          vscode.postMessage({ type: 'delete', sessionId: s.sessionId });
        };
        row.appendChild(del);

        row.onclick = function () { vscode.postMessage({ type: 'open', sessionId: s.sessionId }); };
        listEl.appendChild(row);
      })(shown[i]);
    }
    ensureSpin();
  }

  document.getElementById('newBtn').onclick = function () { vscode.postMessage({ type: 'new' }); };
  document.getElementById('walletStrip').onclick = function () { vscode.postMessage({ type: 'wallet' }); };
  document.getElementById('driveChip').onclick = function (e) { e.stopPropagation(); vscode.postMessage({ type: 'drive' }); };
  onboardEl.onclick = function () { vscode.postMessage({ type: 'new' }); };
  searchEl.addEventListener('input', function () { filter = searchEl.value; render(); });

  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m) return;
    if (m.type === 'sessions') {
      sessions = m.list || [];
      activeId = m.activeId || null;
      running = {};
      runningCount = 0;
      var r = m.running || [];
      for (var i = 0; i < r.length; i++) { running[r[i]] = true; runningCount++; }
      if (m.cloud === 'reauth' || m.cloud === 'transient') {
        warnEl.textContent = m.cloud === 'reauth'
          ? 'Cloud sync signed out. This device only.'
          : 'Cloud unreachable. This device only.';
        warnEl.classList.remove('hidden');
      } else {
        warnEl.classList.add('hidden');
      }
      render();
    } else if (m.type === 'wallet') {
      document.getElementById('waddr').textContent = m.address || '(no wallet)';
    } else if (m.type === 'storage') {
      var chip = document.getElementById('driveChip');
      var lbl = chip.querySelector('.lbl');
      lbl.textContent = m.connected ? (m.label || 'SYNCED') : 'CONNECT';
      chip.classList.toggle('off', !m.connected);
    } else if (m.type === 'onboard') {
      var on = !!m.value;
      onboardEl.classList.toggle('hidden', !on);
      document.getElementById('newBtn').classList.toggle('hidden', on);
      document.getElementById('search').parentElement.classList.toggle('hidden', on);
      listEl.classList.toggle('hidden', on);
      if (on) emptyEl.classList.add('hidden');
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`;
}
