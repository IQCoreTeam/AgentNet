// Panel module cut from the legacy webview script (issue #215). Bodies are verbatim apart from
// the S.<name> state rewrite. Top-level statements live in wireWallet() because ESM evaluates
// modules in dependency order, and main.ts calls the wire functions in the legacy order so
// listener registration and boot posts keep their sequence.
import { S } from "./state.js";
import { avatarSvg } from "../avatar.js";
import { vscode } from "./host.js";
import { short } from "./format.js";
import { updateFdFab } from "./feed.js";

// Fill the wallet pill, the wallet dropdown, and the full wallet page from one address.
export function setWallet(address) {
  S.myWalletAddress = address || null;
  updateFdFab(); // the feed's compose FAB needs a connected wallet
  const full = address || '(not connected)';
  document.getElementById('wAddr').textContent = address ? short(address) : 'not connected';
  const label = address ? short(address) : 'My Wallet';
  document.getElementById('wName').textContent = label;
  document.getElementById('wName2').textContent = address ? 'My Wallet' : 'My Wallet';
  // wallet-seeded character avatar (ported from solchat); same address = same face
  const svg = address ? avatarSvg(address) : '';
  document.getElementById('wAvatar').innerHTML = svg;
  document.getElementById('wAvatar2').innerHTML = svg;
  // #wAvatarBig + #walletAddr are SHARED with the agent-profile view. A wallet/sync
  // push must not clobber them with our own identity while we're browsing someone
  // else's profile — only paint them when the open profile is our own (or none yet).
  if (S.currentProfileWallet === null || S.currentProfileWallet === address) {
    document.getElementById('walletAddr').textContent = full;
    document.getElementById('wAvatarBig').innerHTML = svg;
  }
}

// Drive sync indicator next to the pill: ✓ synced / ⚠ failed (hover = why).
export function renderCloudSync(status) {
  const el = document.getElementById('cloudSync');
  if (!el) return;
  el.onclick = null; el.style.cursor = '';
  if (!status || !S.cloudConnected) { el.textContent = ''; el.className = ''; el.title = ''; return; }
  if (status.ok) { el.textContent = '✓'; el.className = 'ok'; el.title = 'Synced to Drive'; }
  else if (status.reason === 'reauth') {
    // Dead cloud sign-in (token expired/revoked). Google requires interactive consent,
    // so we can't fix it silently — surface a one-tap reconnect right on the indicator.
    el.textContent = '⚠ reconnect';
    el.className = 'err';
    el.title = 'Cloud sign-in expired. Click to reconnect ' + (S.cloudKind === 'gdrive' ? 'Google Drive' : 'cloud') + '.';
    el.style.cursor = 'pointer';
    el.onclick = () => vscode.postMessage({ type: 'reconnectCloud', kind: S.cloudKind || 'gdrive' });
  }
  else { el.textContent = '⚠'; el.className = 'err'; el.title = 'Drive sync failed (auto-retrying): ' + (status.error || 'unknown'); }
}

// My Wallet: storage summary mirrors the pill; address comes from the extension.
export function renderWalletStorage() {
  // Storage line was removed from the profile page (kept only in the wallet dropdown).
  const el = document.getElementById('walletStorage');
  if (!el) return;
  el.textContent = S.cloudConnected ? 'Local + cloud mirror (connected)' : 'Local only (no cloud)';
}

export function wireWallet() {
  document.getElementById('disconnectWalletBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'disconnectWallet' });
  });
  // Dropdown twin of the profile's Disconnect: the surface closes every panel on
  // disconnect, so no local menu-close bookkeeping is needed here.
  document.getElementById('walletDisconnect').addEventListener('click', () => {
    vscode.postMessage({ type: 'disconnectWallet' });
  });
}
