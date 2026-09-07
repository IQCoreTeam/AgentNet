// Panel module cut from the legacy webview script (issue #215). Bodies are verbatim apart from
// the S.<name> state rewrite. Top-level statements live in wireOverlays() because ESM evaluates
// modules in dependency order, and main.ts calls the wire functions in the legacy order so
// listener registration and boot posts keep their sequence.
import { S } from "./state.js";
import { vscode } from "./host.js";
import { fmtSol, netBadge } from "./format.js";
import { escapeHtml } from "./markdown.js";

// ---- COMPLETE overlay: pop the green LED plaque with a [CONTEXT] sub-label, auto-dismiss.
// Design "OVERLAY // COMPLETE": one plaque, only the label swaps per action.
export const celebrateEl = document.getElementById('celebrate') as HTMLDivElement;
export function showComplete(label) {
  celebrateEl.innerHTML =
    '<div class="cmpWrap">'
    + '<div class="cmpPlaque"><div class="cmpLed"><span>COMPLETE</span></div></div>'
    + '<div class="cmpLabel">[' + escapeHtml(label || 'DONE') + ']</div>'
    + '</div>';
  celebrateEl.classList.remove('out');
  celebrateEl.classList.add('show');
  clearTimeout(S.celebTimer);
  S.celebTimer = setTimeout(() => {
    celebrateEl.classList.add('out');
    setTimeout(() => { celebrateEl.classList.remove('show', 'out'); celebrateEl.innerHTML = ''; }, 450);
  }, 2200);
}

// ---- wallet SOL balance: shown in the wallet dropdown + market header ----
export function renderBalance() {
  const txt = fmtSol(S.solLamports);
  const low = S.solLamports != null && S.solLamports < 5000; // basically can't even pay a tx fee
  const wb = document.getElementById('wBalance');
  const mb = document.getElementById('mktBalance');
  if (wb) {
    const amt = wb.querySelector('.balAmt');
    if (txt == null) { wb.style.display = 'none'; }
    else { if (amt) amt.textContent = txt; wb.style.display = 'flex'; wb.classList.toggle('low', low); }
  }
  if (mb) {
    if (txt == null) { mb.style.display = 'none'; }
    else { mb.textContent = txt; mb.style.display = 'inline-flex'; mb.classList.toggle('low', low); }
  }
}

// ---- buy-failure banner: orange-bordered box with an (i) icon, auto-dismiss ----
export const buyErrEl = document.getElementById('buyErr') as HTMLDivElement;
export function showBuyError(msg, fundable?) {
  buyErrEl.innerHTML =
    '<div class="buyErrBox">'
    + '<span class="buyErrIcon">i</span>'
    + '<div class="buyErrText"><span class="t">Purchase failed</span>'
    + '<span class="m">' + escapeHtml(msg || 'Something went wrong. Please try again.') + '</span>'
    + (fundable ? '<button class="buyErrFund">Get devnet SOL</button>' : '')
    + '</div>'
    + '<button class="buyErrClose" title="Dismiss">\u00d7</button>'
    + '</div>';
  buyErrEl.classList.add('show'); buyErrEl.style.display = 'block';
  buyErrEl.querySelector('.buyErrClose').addEventListener('click', hideBuyError);
  // devnet-only: a broke wallet can request faucet SOL right from the banner (airdrop →
  // airdropResult), then retry the buy. The host owns the faucet call (session.ts).
  const fundBtn = buyErrEl.querySelector('.buyErrFund') as HTMLButtonElement;
  if (fundBtn) fundBtn.addEventListener('click', () => {
    fundBtn.disabled = true; fundBtn.textContent = 'Requesting devnet SOL…';
    vscode.postMessage({ type: 'airdrop' });
  });
  clearTimeout(S.buyErrTimer);
  // give time to click the fund button before auto-dismiss
  S.buyErrTimer = setTimeout(hideBuyError, fundable ? 20000 : 7000);
}
export function hideBuyError() {
  clearTimeout(S.buyErrTimer);
  buyErrEl.classList.remove('show');
  setTimeout(() => { if (!buyErrEl.classList.contains('show')) { buyErrEl.style.display = 'none'; buyErrEl.innerHTML = ''; } }, 220);
}

// ---- RPC status (issue #23): show whether a DAS-capable RPC (Helius) is set ----
export const rpcState = document.getElementById('rpcState') as HTMLSpanElement;
export const rpcHint = document.getElementById('rpcHint') as HTMLDivElement;
export const rpcSetBtn = document.getElementById('rpcSetBtn') as HTMLButtonElement;
export const rpcDefaultBtn = document.getElementById('rpcDefaultBtn') as HTMLButtonElement;
// The default RPC is never shown — the user only sees "key set" (green masked box +
// net badge) or "no key" (a warn link to set one). devnet/mainnet is a badge driven
// by the central network. (issue #23)
export function renderRpcStatus(s) {
  s = s || { dasReady: false, hasKey: false, masked: null, network: 'devnet' };
  S.dasReady = !!s.dasReady;
  S.rpcNetwork = s.network || 'devnet';
  if (s.hasKey && s.masked) {
    // green box: masked key (last chars only) + the network badge
    rpcState.innerHTML = '<span class="rpcKeyBox">\u2713 ' + escapeHtml(s.masked) + '</span> ' + netBadge(s.network);
    rpcSetBtn.textContent = 'Change'; rpcSetBtn.style.display = '';
    rpcDefaultBtn.textContent = 'Remove'; rpcDefaultBtn.style.display = '';
    rpcHint.style.display = 'none';
  } else {
    // no key: just a warning that doubles as the set action + the network badge
    rpcState.innerHTML = '<span class="rpcWarn" id="rpcWarnSet">\u26a0 Set Helius key</span> ' + netBadge(s.network);
    const w = document.getElementById('rpcWarnSet');
    if (w) w.addEventListener('click', () => vscode.postMessage({ type: 'setHeliusKey' }));
    rpcSetBtn.style.display = 'none';
    rpcDefaultBtn.style.display = 'none';
    rpcHint.style.display = 'none';
  }
}

// ---- activity marquee: advertise what the agent is doing RIGHT NOW ----
// Map a tool action to a flashy game-verb + object. The verb is picked from a small
// pool (varied per call so it feels alive); the object is the skill name.
export const activityBar = document.getElementById('activityBar') as HTMLDivElement;
export const activityText = document.getElementById('activityText') as HTMLSpanElement;
export const VERBS = { skill: ['Casting', 'Channeling', 'Wielding', 'Invoking'] };
// nft-only marquee: local plaintext skills do not shine here.
export function flashSkill(name, mint) {
  const v = VERBS.skill[(S.pick++) % VERBS.skill.length];
  activityText.innerHTML = '<span class="verb">' + v + '</span> '
    + (name ? '<span class="obj">' + escapeHtml(name) + '</span>' : '');
  activityBar.classList.remove('out');
  activityBar.style.display = 'flex';
  clearTimeout(S.actTimer);
  const dwell = Math.min(4000, 1600 + (name || '').length * 35);
  S.actTimer = setTimeout(() => {
    activityBar.classList.add('out');
    setTimeout(() => { activityBar.style.display = 'none'; activityBar.classList.remove('out'); }, 250);
  }, dwell);
  lightSkillSlot(name, mint, dwell);
}
// glow only while an nft skill is actually firing.
export function lightSkillSlot(name, mint, dwell) {
  const grid = document.getElementById('skillGrid');
  const panel = document.getElementById('skillsPanel');
  const btn = document.getElementById('skillsBtn');
  const clear = () => {
    grid.querySelectorAll('.an-sd.is-firing').forEach((s) => s.classList.remove('is-firing'));
    panel.classList.remove('casting'); btn.classList.remove('casting');
  };
  clear();
  grid.querySelectorAll('.an-sd').forEach((s) => {
    if ((mint && s.getAttribute('data-mint') === mint) || s.getAttribute('data-skill') === name) s.classList.add('is-firing');
  });
  panel.classList.add('casting'); btn.classList.add('casting');
  clearTimeout(S.firingTimer);
  S.firingTimer = setTimeout(clear, Math.max(dwell || 0, 1400));
}
export function hideActivity() { clearTimeout(S.actTimer); activityBar.classList.remove('out'); activityBar.style.display = 'none'; }

export function wireOverlays() {
  celebrateEl.addEventListener('click', () => { // click to dismiss early
    clearTimeout(S.celebTimer);
    celebrateEl.classList.remove('show', 'out'); celebrateEl.innerHTML = '';
  });
  rpcSetBtn.addEventListener('click', () => vscode.postMessage({ type: 'setHeliusKey' }));
  rpcDefaultBtn.addEventListener('click', () => vscode.postMessage({ type: 'useDefaultRpc' }));
  vscode.postMessage({ type: 'getRpcStatus' }); // hydrate on load
}
