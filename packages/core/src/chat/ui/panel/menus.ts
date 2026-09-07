// Panel module cut from the legacy webview script (issue #215). Bodies are verbatim apart from
// the S.<name> state rewrite. Top-level statements live in wireMenus() because ESM evaluates
// modules in dependency order, and main.ts calls the wire functions in the legacy order so
// listener registration and boot posts keep their sequence.
import { S } from "./state.js";
import { vscode } from "./host.js";
import { slashMenu } from "./dom.js";
import { inputWrap } from "./composer.js";
import { showProfile } from "./feed.js";
import { showView } from "./views.js";

// ---- top-bar dropdowns: History (sessions) + Wallet (agent menu) ----
export const histMenu = document.getElementById('histMenu');
export const walletMenu = document.getElementById('walletMenu');
export function closeMenus(except?) {
  if (except !== 'hist') histMenu.style.display = 'none';
  if (except !== 'wallet') walletMenu.style.display = 'none';
}
export function toggleMenu(el, which) {
  const open = el.style.display !== 'none';
  closeMenus(open ? null : which);
  el.style.display = open ? 'none' : 'block';
}

export function wireMenus() {
  document.getElementById('histBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(histMenu, 'hist'); });
  document.getElementById('walletPill').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu(walletMenu, 'wallet');
    if (walletMenu.style.display !== 'none') vscode.postMessage({ type: 'getBalance' }); // refresh funds on open
  });
  document.getElementById('openWalletPage').addEventListener('click', () => { closeMenus(); if (S.myWalletAddress) showProfile(S.myWalletAddress); else showView('wallet'); });
  // click outside closes any open menu
  document.addEventListener('click', (e) => {
    closeMenus();
    if (inputWrap && !inputWrap.contains(e.target as Node)) {
      slashMenu.style.display = 'none';
      S.activeSlashMatches = [];
    }
  });
  histMenu.addEventListener('click', (e) => e.stopPropagation());
  walletMenu.addEventListener('click', (e) => e.stopPropagation());
}
