// Panel module cut from the legacy webview script (issue #215). Bodies are verbatim apart from
// the S.<name> state rewrite. Top-level statements live in wireStorage() because ESM evaluates
// modules in dependency order, and main.ts calls the wire functions in the legacy order so
// listener registration and boot posts keep their sequence.
import { S } from "./state.js";
import { vscode } from "./host.js";

// ---- storage pill (Local always on; Cloud optional mirror) ----
export const cloudState = document.getElementById('cloudState') as HTMLSpanElement;
export const cloudBtn = document.getElementById('cloudBtn') as HTMLButtonElement;

export function renderStorage(info, options) {
  S.storageOptions = options || S.storageOptions;
  S.cloudConnected = !!(info && info.connected);
  if (info && info.kind) S.cloudKind = info.kind;
  if (S.cloudConnected) {
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

export function wireStorage() {

  // connect = pick from a tiny prompt list; disconnect = turn the mirror off.
  cloudBtn.addEventListener('click', () => {
    if (S.cloudConnected) { vscode.postMessage({ type: 'disconnectCloud' }); return; }
    vscode.postMessage({ type: 'pickCloud' }); // extension shows a native quick-pick
  });
}
