// Onboarding webview (HTML + inline JS) — the FIRST screen before chat.
//
// Two steps, and storage is OPTIONAL:
//   1) Connect wallet     -> {type:"connectWallet"}        -> ext loads local keypair
//   2) Storage (optional) -> {type:"chooseStorage", kind}  primary = connect a cloud
//                            {type:"skipStorage"}          grey = "maybe later" (local only)
//
// The extension owns all real work (loadOrCreateWallet / initialize / connect);
// this view just collects clicks and shows state. Local-save and cloud-save are
// tracked SEPARATELY: you always have local; a cloud is an extra you can add now or later.

export function onboardingHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body { font-family: var(--vscode-font-family); margin: 0; color: var(--vscode-foreground);
         background: var(--vscode-editor-background); display: flex; flex-direction: column;
         align-items: center; justify-content: center; height: 100vh; padding: 24px; box-sizing: border-box; }
  .card { width: 100%; max-width: 420px; }
  h1 { font-size: 1.4em; margin: 0 0 4px; }
  .sub { opacity: 0.6; font-size: 0.9em; margin-bottom: 24px; }
  .step { display: none; }
  .step.active { display: block; }

  .row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px;
         background: var(--vscode-editorWidget-background); margin-bottom: 10px; }
  .row .grow { flex: 1; min-width: 0; }
  .addr { font-family: var(--vscode-editor-font-family); font-size: 0.85em; opacity: 0.8;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ok { color: var(--vscode-testing-iconPassed, #3a3); }

  button { padding: 10px 16px; border: none; border-radius: 6px; cursor: pointer; font-size: 0.95em; width: 100%; }
  .primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .primary:hover { background: var(--vscode-button-hoverBackground); }
  .ghost { background: transparent; color: var(--vscode-foreground); opacity: 0.6;
           border: 1px solid var(--vscode-panel-border); margin-top: 8px; }
  .ghost:hover { opacity: 1; }

  .opts { display: flex; flex-direction: column; gap: 8px; margin: 14px 0; }
  .opt { display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
         padding: 10px 12px; border-radius: 8px; cursor: pointer; text-align: left;
         background: var(--vscode-editorWidget-background); border: 1px solid transparent; }
  .opt:hover { border-color: var(--vscode-focusBorder); }
  .opt b { font-size: 0.95em; }
  .opt small { opacity: 0.55; font-size: 0.82em; }

  .note { font-size: 0.8em; opacity: 0.7; line-height: 1.5; margin-top: 16px;
          padding: 10px 12px; border-radius: 8px; background: var(--vscode-textBlockQuote-background);
          border-left: 3px solid var(--vscode-textBlockQuote-border); }
  .custom { margin-top: 10px; display: none; }
  .custom.show { display: block; }
  .custom input { width: 100%; box-sizing: border-box; padding: 8px; margin-bottom: 6px;
                  background: var(--vscode-input-background); color: var(--vscode-input-foreground);
                  border: 1px solid var(--vscode-input-border); border-radius: 6px; }
  .fieldLabel { display: block; font-size: 0.8em; opacity: 0.6; margin-bottom: 5px; }
  #walletPath { width: 100%; box-sizing: border-box; padding: 9px 10px; margin-bottom: 6px;
                font-family: var(--vscode-editor-font-family); font-size: 0.85em;
                background: var(--vscode-input-background); color: var(--vscode-input-foreground);
                border: 1px solid var(--vscode-input-border); border-radius: 6px; }
  #walletPath.bad { border-color: var(--vscode-inputValidation-errorBorder, #be1100); }
  .hint { font-size: 0.78em; opacity: 0.55; margin-bottom: 12px; line-height: 1.4; }
  .opt.selected { border-color: var(--vscode-focusBorder); }
</style>
</head>
<body>
<div class="card">
  <h1>AgentNet</h1>
  <div class="sub">Connect a wallet. Your sessions are encrypted to it.</div>

  <!-- STEP 1: wallet. Two modes by surface (filled in by script):
       - local  (vscode/cli): choose / create a Solana keypair by file path
       - web    (browser/mobile): connect a wallet (Phantom/Solflare/Backpack/…) -->
  <div class="step active" id="step-wallet">
    <div class="row" id="walletRow" style="display:none">
      <span class="ok">●</span>
      <div class="grow"><div class="addr" id="walletAddr"></div></div>
    </div>

    <!-- local-keypair mode (vscode/cli) -->
    <div id="walletLocal">
      <label class="fieldLabel">Solana keypair file</label>
      <input id="walletPath" spellcheck="false" placeholder="/path/to/id.json" />
      <div class="hint" id="walletHint">If no keypair exists here, a new one is created at this path.</div>
      <button class="primary" id="connectBtn">Use this wallet</button>
      <div class="note">
        This keypair is your wallet. The same wallet = the same key that decrypts
        your sessions on any device.
      </div>
    </div>

    <!-- web-wallet mode (browser/mobile): one button per DETECTED wallet -->
    <div id="walletWeb" style="display:none">
      <div id="walletButtons"><!-- filled from detected providers --></div>
      <div class="hint" id="noWallet" style="display:none">
        No Solana wallet detected. Install Phantom, Solflare, or Backpack and reload.
      </div>
      <div class="note">
        Connect your wallet. You'll sign one message so this device can encrypt your
        sessions to you: it's an off-chain signature, not a transaction (nothing
        on-chain, no fee). The same wallet decrypts your sessions on any device.
      </div>
    </div>
  </div>

  <!-- STEP 2: storage (optional) -->
  <div class="step" id="step-storage">
    <div class="row">
      <span class="ok">●</span>
      <div class="grow"><div class="addr" id="walletAddr2"></div></div>
    </div>
    <div class="row" style="background:transparent;border:1px solid var(--vscode-panel-border)">
      <span class="ok">●</span>
      <div class="grow"><b>This device</b><div class="sub" style="margin:0">Always on. Sessions are saved locally.</div></div>
    </div>
    <p style="margin:14px 0 0">Mirror to a cloud? <span style="opacity:.5">(optional)</span></p>
    <div class="sub">Connect a cloud so the same sessions follow your wallet to other devices. You can also add this later.</div>

    <div class="opts" id="storageOpts"><!-- filled from STORAGE_OPTIONS --></div>

    <div class="custom" id="customFields">
      <input id="customUrl" placeholder="https://your-endpoint... (S3 / WebDAV / HTTP)" />
      <input id="customAuth" placeholder="Authorization header (optional)" />
    </div>

    <p style="margin:14px 0 0">Marketplace RPC <span style="opacity:.5">(recommended)</span></p>
    <div class="sub">The skill marketplace reads on-chain data via an RPC. The built-in default is rate-limited and can't load the market; a free <b>Helius</b> key (devnet tier) fixes it. You can start now and add the key anytime from the wallet menu &rarr; RPC.</div>

    <button class="primary" id="connectStorageBtn">Connect cloud &amp; continue</button>
    <button class="ghost" id="skipBtn">Keep on this device only (maybe later)</button>

    <div class="note">
      Heads up: connecting a cloud means your keypair lives on this device
      <em>and</em> your sessions live in that cloud. Keep both in good hands.
      If a device and the cloud were compromised at the same time, someone could
      reach your sessions. Nothing to fear, just worth managing well.
    </div>
  </div>
</div>
<script>
  // Host pipe — same shim as the chat webview (kept identical; both live in inline
  // <script> strings so they can't share an import): acquireVsCodeApi() inside VSCode,
  // else HTTP-RPC + SSE. postMessage(obj) → POST /rpc; the SSE stream (GET /events)
  // becomes window 'message' events. The server issues a client id we tag onto POSTs.
  const IS_VSCODE = typeof acquireVsCodeApi === "function";
  const vscode = IS_VSCODE
    ? acquireVsCodeApi()
    : (() => {
        let clientId = null;
        const outbox = [];
        function post(s) {
          fetch("/rpc?client=" + encodeURIComponent(clientId), {
            method: "POST", headers: { "content-type": "application/json" }, body: s,
          }).catch(() => {});
        }
        function open(url) {
          const es = new EventSource(url);
          es.addEventListener("client", (e) => {
            const id = JSON.parse(e.data).client;
            if (clientId === null) {
              clientId = id;
              es.close();
              open("/events?client=" + encodeURIComponent(id));
              for (const m of outbox.splice(0)) post(m);
            }
          });
          es.onmessage = (e) => window.dispatchEvent(new MessageEvent("message", { data: JSON.parse(e.data) }));
        }
        open("/events");
        return {
          postMessage: (obj) => {
            const s = JSON.stringify(obj);
            if (clientId !== null) post(s); else outbox.push(s);
          },
        };
      })();

  const $ = (id) => document.getElementById(id);
  let chosenKind = null;
  const NEEDS_LOCATION = { custom: true }; // which kinds need extra input fields

  // STEP 1 mode: local keypair (vscode/cli) vs web wallet (browser/mobile).
  // A browser has no acquireVsCodeApi → web-wallet mode (Phantom/Solflare/Backpack/…).
  const WEB = !IS_VSCODE;
  $('walletLocal').style.display = WEB ? 'none' : 'block';
  $('walletWeb').style.display = WEB ? 'block' : 'none';

  // The exact message the session-key derivation signs (must match SESSION_KEY_MESSAGE
  // in webWallet.ts / deriveX25519Keypair — same bytes → same key).
  const SESSION_KEY_MESSAGE = "iq-sdk-derive-encryption-key-v1";

  // Detect installed Solana wallets. Most inject a provider on a well-known global and
  // follow Phantom's connect()/signMessage() shape, so one path handles them all — we
  // just label the button by which provider answered. window.solana is the de-facto
  // standard slot (Phantom/Solflare/… set it), kept last as the catch-all.
  function detectWallets() {
    const w = window;
    const seen = new Set();
    const found = [];
    const add = (name, provider) => {
      if (!provider || typeof provider.signMessage !== 'function' || seen.has(provider)) return;
      seen.add(provider);
      found.push({ name, provider });
    };
    add('Phantom',  w.phantom && w.phantom.solana);
    add('Solflare', w.solflare);
    add('Backpack', w.backpack);
    add('OKX',      w.okxwallet && w.okxwallet.solana);
    // catch-all: whatever set window.solana, if not already added by identity above.
    add(w.solana && w.solana.isPhantom ? 'Phantom' : 'Wallet', w.solana);
    return found;
  }

  async function connectWith(provider) {
    try {
      const res = await provider.connect();
      const pk = (res && res.publicKey) || provider.publicKey;
      const address = pk.toString();
      // Off-chain signMessage over the FIXED bytes — this is what derives the session
      // key. One prompt; the signature is reused for every session.
      const signed = await provider.signMessage(new TextEncoder().encode(SESSION_KEY_MESSAGE), 'utf8');
      const signature = signed.signature || signed; // some wallets return raw bytes
      vscode.postMessage({ type: 'connectWallet', address, signature: Array.from(signature) });
    } catch (e) {
      vscode.postMessage({ type: 'toast', text: 'Wallet connection cancelled.' });
    }
  }

  if (WEB) {
    const wallets = detectWallets();
    const box = $('walletButtons');
    if (!wallets.length) {
      $('noWallet').style.display = 'block';
    } else {
      for (const { name, provider } of wallets) {
        const btn = document.createElement('button');
        btn.className = 'primary';
        btn.style.marginBottom = '8px';
        btn.textContent = 'Connect ' + name;
        btn.addEventListener('click', () => connectWith(provider));
        box.appendChild(btn);
      }
    }
  }

  // step switching
  function show(step) {
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    $('step-' + step).classList.add('active');
  }

  // A keypair path must be absolute and end in .json (we never overwrite an existing
  // valid one — the extension loads it, or creates a new keypair only if missing).
  function validPath(p) { return /^(\\/|[A-Za-z]:\\\\|~\\/).*\\.json$/.test(p.trim()); }
  if (!WEB) $('connectBtn').addEventListener('click', () => {
    const p = $('walletPath').value.trim();
    if (!validPath(p)) {
      $('walletPath').classList.add('bad');
      vscode.postMessage({ type: 'toast', text: 'Enter an absolute path to a .json keypair file.' });
      return;
    }
    $('walletPath').classList.remove('bad');
    vscode.postMessage({ type: 'connectWallet', path: p });
  });
  if (!WEB) $('walletPath').addEventListener('input', () => $('walletPath').classList.remove('bad'));

  function pickOption(el, kind) {
    chosenKind = kind;
    document.querySelectorAll('.opt').forEach(x => x.classList.remove('selected'));
    el.classList.add('selected');
    $('customFields').classList.toggle('show', !!NEEDS_LOCATION[kind]);
  }
  // storage option list; preselect = a kind to mark chosen up front (already-connected cloud)
  function renderOptions(opts, preselect) {
    const box = $('storageOpts');
    box.innerHTML = '';
    for (const o of opts) {
      const el = document.createElement('div');
      el.className = 'opt';
      el.innerHTML = '<b>' + o.label + '</b><small>' + o.needs + '</small>';
      el.onclick = () => pickOption(el, o.kind);
      box.appendChild(el);
      if (preselect && o.kind === preselect) pickOption(el, o.kind);
    }
  }

  $('connectStorageBtn').addEventListener('click', () => {
    if (!chosenKind) { vscode.postMessage({ type: 'toast', text: 'Pick a storage option first.' }); return; }
    const msg = { type: 'chooseStorage', kind: chosenKind };
    if (chosenKind === 'custom') {
      msg.location = $('customUrl').value.trim();
      msg.authHeader = $('customAuth').value.trim() || undefined;
    }
    vscode.postMessage(msg);
  });
  $('skipBtn').addEventListener('click', () => vscode.postMessage({ type: 'skipStorage' }));

  let cloudPreselect = null; // a cloud kind to mark chosen if one was already connected
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'init') {
      if (m.defaultPath) $('walletPath').value = m.defaultPath;
      cloudPreselect = m.cloudKind || null; // e.g. "gdrive" if already connected
    } else if (m.type === 'walletConnected') {
      // Browser/mobile: the wallet is the whole onboarding — local save is always on
      // and a cloud can be added later from chat, so go straight to chat (this socket
      // is already attached to the chat dispatcher on the host side).
      if (WEB) { location.href = '/'; return; }
      $('walletRow').style.display = 'flex';
      $('walletAddr').textContent = m.address;
      $('walletAddr2').textContent = m.address;
      renderOptions(m.storageOptions || [], cloudPreselect);
      show('storage');
    }
  });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
