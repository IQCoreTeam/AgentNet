// Panel module cut from the legacy webview script (issue #215). Bodies are verbatim apart from
// the S.<name> state rewrite. Top-level statements live in wireSessions() because ESM evaluates
// modules in dependency order, and main.ts calls the wire functions in the legacy order so
// listener registration and boot posts keep their sequence.
import { S } from "./state.js";
import { vscode } from "./host.js";
import { emptyEl, sessList, showAll } from "./dom.js";
import { rel } from "./format.js";
import { closeMenus } from "./menus.js";

export const COLLAPSED = 5;      // sessions shown before "모두 보기(N)"

// ---- session list (title + relative time + 모두 보기) ----
export function renderSessions() {
  sessList.innerHTML = '';
  // A degraded cloud makes this list silently local-only; say so instead of letting
  // sessions from other devices look deleted. reauth = sign-in dead (user must
  // reconnect in Storage); transient = network/5xx, may heal on the next refresh.
  if (S.cloudListState === 'reauth' || S.cloudListState === 'transient') {
    const warn = document.createElement('div');
    warn.style.cssText = 'padding:4px 8px;font-size:11px;color:var(--vscode-editorWarning-foreground, #e5c07b);opacity:.9';
    warn.textContent = S.cloudListState === 'reauth'
      ? 'Cloud sync signed out. Showing this device only. Reconnect in Storage.'
      : 'Cloud unreachable. Showing this device only.';
    sessList.appendChild(warn);
  }
  emptyEl.style.display = S.allSessions.length ? 'none' : 'block';
  const shown = S.expanded ? S.allSessions : S.allSessions.slice(0, COLLAPSED);
  for (const s of shown) {
    const el = document.createElement('div');
    el.className = 'sess' + (s.sessionId === S.activeId ? ' active' : '');
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = s.title || '(untitled)';
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = rel(s.ts);
    const del = document.createElement('span');
    del.className = 'del';
    del.textContent = '\u2715'; // x mark
    del.title = 'Delete session';
    del.onclick = (e) => {
      e.stopPropagation(); // don't trigger the row's open
      vscode.postMessage({ type: 'delete', sessionId: s.sessionId });
    };
    el.appendChild(title); el.appendChild(time); el.appendChild(del);
    // cross-CLI: clicking opens the session in the CURRENT tab's cli, so we no
    // longer send the session's own cli (the extension ignores it).
    el.onclick = () => { vscode.postMessage({ type: 'open', sessionId: s.sessionId }); closeMenus(); };
    sessList.appendChild(el);
  }
  if (S.allSessions.length > COLLAPSED) {
    showAll.style.display = 'block';
    showAll.textContent = S.expanded ? '접기' : '모두 보기(' + S.allSessions.length + ')';
  } else {
    showAll.style.display = 'none';
  }
}

export function wireSessions() {
  showAll.addEventListener('click', () => { S.expanded = !S.expanded; renderSessions(); });
}
