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
</style>
</head>
<body>
<div class="card">
  <h1>AgentNet</h1>
  <div class="sub">Connect a wallet — your sessions are encrypted to it.</div>

  <!-- STEP 1: wallet -->
  <div class="step active" id="step-wallet">
    <div class="row" id="walletRow" style="display:none">
      <span class="ok">●</span>
      <div class="grow"><div class="addr" id="walletAddr"></div></div>
    </div>
    <button class="primary" id="connectBtn">Connect Wallet</button>
    <div class="note">
      A local Solana keypair on this device acts as your wallet for now
      (a real Phantom connection comes later). The same wallet = the same
      key that decrypts your sessions on any device.
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
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  let chosenKind = null;
  const NEEDS_LOCATION = { custom: true }; // which kinds need extra input fields

  // step switching
  function show(step) {
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    $('step-' + step).classList.add('active');
  }

  $('connectBtn').addEventListener('click', () => vscode.postMessage({ type: 'connectWallet' }));

  // storage option list (from extension via {type:'storageOptions'})
  function renderOptions(opts) {
    const box = $('storageOpts');
    box.innerHTML = '';
    for (const o of opts) {
      const el = document.createElement('div');
      el.className = 'opt';
      el.innerHTML = '<b>' + o.label + '</b><small>' + o.needs + '</small>';
      el.onclick = () => {
        chosenKind = o.kind;
        document.querySelectorAll('.opt').forEach(x => x.style.borderColor = 'transparent');
        el.style.borderColor = 'var(--vscode-focusBorder)';
        $('customFields').classList.toggle('show', !!NEEDS_LOCATION[o.kind]);
      };
      box.appendChild(el);
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

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'walletConnected') {
      $('walletRow').style.display = 'flex';
      $('walletAddr').textContent = m.address;
      $('walletAddr2').textContent = m.address;
      renderOptions(m.storageOptions || []);
      show('storage');
    }
  });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
