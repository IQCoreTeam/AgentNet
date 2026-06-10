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
  /* ── AgentNet tone system ──────────────────────────────────────────────
     One green accent threaded through the whole UI (the codex badge green,
     reused as THE brand accent so the app reads as "ours", not stock VSCode).
     Layered surfaces (bg-0 deepest → bg-2 raised) give cards real depth
     instead of one flat fill. All built on VSCode vars so themes still apply. */
  :root {
    --an-green:      #3ac07a;          /* brand accent */
    --an-green-soft: rgba(58,192,122,0.16);
    --an-green-line: rgba(58,192,122,0.38);
    --an-green-dim:  rgba(58,192,122,0.08);
    --an-amber:      #e0a23a;          /* compaction / context boundary */
    /* surface ramp — subtle, sits on top of the editor bg */
    --an-bg-1: color-mix(in srgb, var(--vscode-foreground) 4%, transparent);
    --an-bg-2: color-mix(in srgb, var(--vscode-foreground) 7%, transparent);
    --an-line: color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
    --an-line-soft: color-mix(in srgb, var(--vscode-foreground) 7%, transparent);
    --an-radius: 12px;
    --an-radius-sm: 8px;
  }
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
  .tab.active { opacity: 1; border-bottom-color: var(--an-green); color: var(--an-green); }
  #storagePill { margin: 0 10px 0 auto; padding: 3px 11px; display: flex; align-items: center; gap: 5px;
                 font-size: 0.78em; opacity: 0.85; background: var(--an-bg-1); border-radius: 999px; }
  #storagePill .dot { font-size: 0.7em; }
  #storagePill .dot.local { color: var(--an-green); }
  #storagePill .dot.cloud-on { color: var(--an-green); }
  #storagePill .dot.cloud-off { color: var(--vscode-disabledForeground, #888); }
  #storagePill .sep { opacity: 0.3; }
  #storagePill .acct { opacity: 0.5; }
  #storagePill .link { background: none; border: none; padding: 0 2px; width: auto;
                       color: var(--an-green); cursor: pointer; font-size: 1em; }
  #storagePill .link:hover { text-decoration: underline; }
  #cloudSync { font-size: 0.92em; }
  #cloudSync.ok { color: var(--an-green); }
  #cloudSync.err { color: var(--vscode-errorForeground, #e55); cursor: help; }

  #wrap { flex: 1; display: flex; min-height: 0; }

  /* left session list */
  #sidebar { width: 230px; border-right: 1px solid var(--vscode-panel-border);
             display: flex; flex-direction: column; overflow-y: auto; }
  #sidebar h3 { font-size: 0.68em; opacity: 0.5; padding: 12px 14px 6px; margin: 0;
                text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; }
  .sess { display: flex; justify-content: space-between; gap: 8px; align-items: baseline;
          padding: 7px 11px; cursor: pointer; font-size: 0.9em; border-left: 2px solid transparent;
          border-radius: var(--an-radius-sm); margin: 1px 6px; transition: background 0.12s; }
  .sess:hover { background: var(--an-bg-1); }
  .sess.active { background: var(--an-green-dim); border-left-color: var(--an-green); }
  .sess.active .title { color: var(--an-green); }
  .sess .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .sess .time { opacity: 0.45; font-size: 0.8em; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .sess .del { opacity: 0; font-size: 0.9em; padding: 0 2px; border-radius: 3px; }
  .sess:hover .del { opacity: 0.5; }
  .sess .del:hover { opacity: 1; background: var(--vscode-inputValidation-errorBackground); }
  #showAll { padding: 8px 12px; cursor: pointer; font-size: 0.85em; opacity: 0.6; }
  #showAll:hover { opacity: 1; }
  #empty { opacity: 0.4; text-align: center; padding: 24px 12px; font-size: 0.85em; }
  /* a quiet ghost "+ New" that lights up green on hover — not a heavy primary button */
  #newBtn { margin: 6px 10px 10px; background: transparent; color: var(--vscode-foreground);
            border: 1px dashed var(--an-line); border-radius: var(--an-radius-sm);
            opacity: 0.75; font-size: 0.85em; padding: 7px; transition: all 0.12s; }
  #newBtn:hover { opacity: 1; color: var(--an-green); border-color: var(--an-green-line);
                  background: var(--an-green-dim); }

  /* sessions scroll; wallet card pinned to the BOTTOM of the sidebar */
  #sessScroll { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
  /* the wallet = the agent. always visible, bottom-left, "this is mine" */
  #walletCard { border-top: 1px solid var(--vscode-panel-border); padding: 10px 12px;
                display: flex; align-items: center; gap: 9px; cursor: pointer;
                background: var(--vscode-editorWidget-background); user-select: none; }
  #walletCard:hover { background: var(--vscode-list-hoverBackground); }
  #walletCard.active { border-top-color: var(--an-green-line);
                       box-shadow: inset 2px 0 0 var(--an-green); }
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
  #log { flex: 1; overflow-y: auto; padding: 14px 14px 18px; display: flex; flex-direction: column; gap: 2px;
         scroll-behavior: smooth; }

  /* a row = bubble (+ optional badge/footer under it). The ROW owns left/right
     alignment; the bubble sizes to its content. */
  .msgRow { display: flex; flex-direction: column; max-width: 82%; }
  .msgRow.user { align-self: flex-end; align-items: flex-end; }
  .msgRow.assistant, .msgRow.thinking, .msgRow.tool { align-self: flex-start; align-items: flex-start; }
  .msg { margin: 5px 0; padding: 9px 14px; border-radius: 16px; white-space: pre-wrap; line-height: 1.5;
         font-size: 0.95em; }
  /* chat-bubble feel: round, with the "tail" corner slightly tucked */
  .msgRow.user .msg      { border-bottom-right-radius: 4px; }
  .msgRow.assistant .msg { border-bottom-left-radius: 4px; }
  /* user bubble carries the brand with a soft green wash (no border — a border on a
     rounded bubble reads as a "box inside a box", esp. on short messages) */
  .user      { background: var(--an-green-soft); }
  .assistant { background: var(--an-bg-2); }
  .thinking  { opacity: 0.5; font-style: italic; font-size: 0.9em; }
  .tool      { opacity: 0.8; font-family: var(--vscode-editor-font-family); font-size: 0.9em; }

  /* collapse long user messages behind a fade + show more (OpenGUI pattern) */
  .msg.clamp { max-height: 11lh; overflow: hidden; position: relative; }
  .msg.clamp::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 3lh;
                      background: linear-gradient(to top, var(--an-green-soft), transparent);
                      pointer-events: none; }
  .moreBtn { font-size: 0.78em; opacity: 0.6; cursor: pointer; margin: 1px 6px 4px;
             background: none; border: none; color: var(--vscode-foreground); width: auto; padding: 2px; }
  .moreBtn:hover { opacity: 1; color: var(--an-green); }

  /* turn footer under an assistant reply: elapsed time + model, tabular & quiet */
  .footer { display: flex; align-items: center; gap: 7px; margin: 0 4px 4px; font-size: 0.7em;
            opacity: 0.45; font-variant-numeric: tabular-nums; }
  .footer .mdl { opacity: 0.8; }

  /* context-compaction boundary: an amber rule that says "history was summarized here" */
  .compactRule { display: flex; align-items: center; gap: 9px; align-self: stretch; max-width: 100%;
                 margin: 12px 2px; user-select: none; }
  .compactRule .ln { flex: 1; height: 1px; background: color-mix(in srgb, var(--an-amber) 32%, transparent); }
  .compactRule .lbl { font-size: 0.7em; letter-spacing: 0.04em; text-transform: uppercase;
                      color: var(--an-amber); opacity: 0.85; display: inline-flex; align-items: center; gap: 5px;
                      font-family: var(--vscode-editor-font-family); }
  .summaryBody { align-self: stretch; max-width: 100%; margin: 0 2px 6px; padding: 10px 13px;
                 font-size: 0.86em; line-height: 1.5; opacity: 0.72; white-space: pre-wrap;
                 border-left: 2px solid color-mix(in srgb, var(--an-amber) 45%, transparent);
                 background: color-mix(in srgb, var(--an-amber) 6%, transparent);
                 border-radius: 0 var(--an-radius-sm) var(--an-radius-sm) 0; }
  .summaryBody.clamp { max-height: 8lh; overflow: hidden; }

  /* tool action cards: what the agent actually DID (bash / diff / file op).
     Look: a quiet raised surface (bg-1) with a faint border; the HEAD is a
     thin monospace row (icon + command), output sits below a hairline. Borrowed
     the "soft bg / bright text" split + collapsible chevron from OpenGUI. */
  .msgRow.tool { align-self: stretch; align-items: stretch; max-width: 100%; }
  .toolCard { font-family: var(--vscode-editor-font-family); font-size: 0.8em;
              border: 1px solid var(--an-line-soft); border-radius: var(--an-radius-sm);
              margin: 5px 0; overflow: hidden; background: var(--an-bg-1); }
  .toolCard.op { padding: 6px 11px; opacity: 0.75; display: flex; align-items: center; gap: 7px; }
  .toolCard.op .icon { opacity: 0.6; }
  /* expandable head: a <details>/<summary>-style row with a rotating chevron */
  .toolHead { padding: 7px 11px; display: flex; gap: 7px; align-items: center;
              cursor: default; line-height: 1.4; }
  .toolHead.clickable { cursor: pointer; user-select: none; }
  .toolHead.clickable:hover { background: var(--an-bg-2); }
  .toolHead .chev { width: 11px; height: 11px; flex: none; opacity: 0.5;
                    transition: transform 0.15s ease; }
  .toolHead.open .chev { transform: rotate(90deg); }
  .toolHead .tk { color: var(--an-green); font-weight: 700; flex: none; }
  .toolHead .cmd { white-space: pre-wrap; word-break: break-all; color: var(--vscode-foreground);
                   opacity: 0.92; min-width: 0; flex: 1; }
  .toolHead .file { opacity: 0.92; min-width: 0; flex: 1; overflow: hidden;
                    text-overflow: ellipsis; white-space: nowrap; }
  /* inline +/- stat on edit cards (emerald / red, OpenGUI-style) */
  .toolHead .stat { margin-left: auto; flex: none; font-size: 0.92em;
                    display: inline-flex; gap: 5px; font-variant-numeric: tabular-nums; }
  .toolHead .stat .plus { color: var(--an-green); }
  .toolHead .stat .minus { color: #e06c6c; }
  .toolCard.failed .toolHead { background: rgba(224,108,108,0.10); }
  .toolCard.failed .tk { color: #e06c6c; }
  .toolOut { margin: 0; padding: 8px 11px; max-height: 220px; overflow: auto;
             white-space: pre-wrap; word-break: break-all; opacity: 0.8; font-size: 0.95em;
             border-top: 1px solid var(--an-line-soft); }
  .toolBody[hidden] { display: none; }
  .diffBody { margin: 0; padding: 5px 0; max-height: 320px; overflow: auto;
              border-top: 1px solid var(--an-line-soft); line-height: 1.5; }
  .diffBody > div { padding: 0 11px 0 6px; white-space: pre-wrap; word-break: break-all; }
  .diffBody .gut { display: inline-block; width: 14px; text-align: center; opacity: 0.5;
                   user-select: none; flex: none; }
  .diffBody .add { background: var(--an-green-dim); color: var(--an-green); }
  .diffBody .del { background: rgba(224,108,108,0.10); color: #e07a7a; }
  .diffBody .ctx { opacity: 0.5; }
  .diffBody .fold { opacity: 0.35; padding: 1px 11px; user-select: none; font-style: italic; }

  /* tool-APPROVAL card: like a tool card but actionable — green ring + buttons.
     This is where claude's canUseTool surfaces; the user gates each tool here. */
  .approvalCard { align-self: stretch; max-width: 100%; margin: 6px 0;
                  border: 1px solid var(--an-green-line); border-radius: var(--an-radius-sm);
                  background: var(--an-green-dim); overflow: hidden;
                  box-shadow: 0 0 0 1px var(--an-green-dim); }
  .apHead { display: flex; align-items: center; gap: 8px; padding: 8px 12px;
            font-family: var(--vscode-editor-font-family); font-size: 0.85em; }
  .apHead .apk { color: var(--an-green); font-weight: 700; }
  .apTitle { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .apTag { font-size: 0.78em; opacity: 0.6; text-transform: lowercase; padding: 1px 7px;
           border: 1px solid var(--an-line); border-radius: 999px; }
  .apBody { margin: 0; padding: 8px 12px; font-family: var(--vscode-editor-font-family);
            font-size: 0.8em; white-space: pre-wrap; word-break: break-all; opacity: 0.9;
            border-top: 1px solid var(--an-green-dim); max-height: 240px; overflow: auto; }
  .apActions { display: flex; gap: 8px; padding: 9px 12px; border-top: 1px solid var(--an-green-dim); }
  .apBtn { width: auto; padding: 6px 16px; font-size: 0.85em; font-weight: 600; border-radius: 6px; }
  .apBtn.ok { background: var(--an-green); color: #06231a; }
  .apBtn.ok:hover { filter: brightness(1.08); }
  .apBtn.always { background: transparent; color: var(--an-green); border: 1px solid var(--an-green-line); }
  .apBtn.always:hover { background: var(--an-green-dim); }
  .apBtn.no { background: transparent; color: #e07a7a; border: 1px solid rgba(224,108,108,0.4); }
  .apBtn.no:hover { background: rgba(224,108,108,0.12); }
  .apResolved { padding: 8px 12px; font-size: 0.82em; border-top: 1px solid var(--an-green-dim); }
  .apResolved.allowed { color: var(--an-green); }
  .apResolved.denied { color: #e07a7a; }
  .cursor::after { content: "\\u258B"; opacity: 0.6; animation: blink 1s step-end infinite; }
  @keyframes blink { 50% { opacity: 0; } }

  /* "claude is working" typing indicator (animated dots) */
  .typing { display: flex; align-items: center; gap: 8px; opacity: 0.85; }
  .typing .who { font-size: 0.8em; opacity: 0.6; text-transform: lowercase; }
  .typing .dots { display: inline-flex; gap: 4px; }
  .typing .dots i { width: 6px; height: 6px; border-radius: 50%;
                    background: var(--an-green); opacity: 0.5;
                    animation: typingBounce 1.2s infinite ease-in-out; }
  .typing .dots i:nth-child(2) { animation-delay: 0.18s; }
  .typing .dots i:nth-child(3) { animation-delay: 0.36s; }
  @keyframes typingBounce { 0%,60%,100% { transform: translateY(0); opacity: 0.35; }
                            30% { transform: translateY(-4px); opacity: 0.9; } }

  /* platform badge chip under an assistant bubble */
  .badge { font-size: 0.62em; opacity: 0.85; margin: 0 4px 3px; padding: 1px 8px;
           border-radius: 999px; font-weight: 600; letter-spacing: 0.03em;
           border: 1px solid transparent; display: inline-flex; align-items: center; gap: 4px; }
  .badge::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
  .badge.claude { color: #e9883a; border-color: #e9883a44; background: #e9883a14; }
  .badge.codex  { color: var(--an-green); border-color: var(--an-green-line); background: var(--an-green-dim); }

  #controls { display: flex; gap: 8px; align-items: center; padding: 6px 10px;
              border-top: 1px solid var(--vscode-panel-border); font-size: 0.85em; }
  #controls label { opacity: 0.6; }
  #model { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground);
           border: 1px solid var(--vscode-dropdown-border); border-radius: 4px; padding: 3px 6px; }
  #bar { display: flex; gap: 8px; padding: 10px 12px 12px; border-top: 1px solid var(--an-line-soft); }
  #input { flex: 1; padding: 9px 12px; background: var(--vscode-input-background);
           color: var(--vscode-input-foreground); border: 1px solid var(--an-line);
           border-radius: var(--an-radius-sm); resize: none; font-family: inherit; transition: border-color 0.12s; }
  #input:focus { outline: none; border-color: var(--an-green-line);
                 box-shadow: 0 0 0 2px var(--an-green-dim); }
  button { padding: 8px 14px; background: var(--vscode-button-background);
           color: var(--vscode-button-foreground); border: none; border-radius: 6px; cursor: pointer; }
  /* Send carries the brand green; New is the ghost above */
  #send { background: var(--an-green); color: #06231a; font-weight: 600; }
  #send:hover { filter: brightness(1.08); }
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
    el._row = row; // bubble's row, so callers can attach a footer / clamp toggle
    return el;
  }

  // Clamp a long body element behind a fade with a "show more / less" toggle.
  // Used for verbose user messages and folded summaries.
  function clampBody(el, row, threshold) {
    if ((el.textContent || '').length <= threshold) return;
    el.classList.add('clamp');
    const btn = document.createElement('button');
    btn.className = 'moreBtn'; btn.textContent = 'show more';
    btn.addEventListener('click', () => {
      const on = el.classList.toggle('clamp');
      btn.textContent = on ? 'show more' : 'show less';
    });
    row.appendChild(btn);
  }

  // A /compact boundary: an amber rule ("CONTEXT COMPACTED") plus the summary text
  // in a quiet, foldable side-barred block. role:"summary" records land here so the
  // user SEES where history was condensed instead of it reading as a normal turn.
  function renderSummary(text, prepend) {
    const rule = document.createElement('div');
    rule.className = 'compactRule';
    rule.innerHTML = '<div class="ln"></div><span class="lbl">⌘ context compacted</span><div class="ln"></div>';
    const body = document.createElement('div');
    body.className = 'summaryBody';
    body.textContent = text;
    if (prepend) { log.insertBefore(body, log.firstChild); log.insertBefore(rule, body); }
    else { log.appendChild(rule); log.appendChild(body); clampBody(body, body, 400); log.scrollTop = log.scrollHeight; }
  }

  // The footer under an assistant reply: elapsed time + model name (when known).
  function addFooter(row, durationMs, model) {
    if (durationMs == null && !model) return;
    const f = document.createElement('div'); f.className = 'footer';
    if (durationMs != null) {
      const s = durationMs / 1000;
      f.appendChild(document.createTextNode(s < 60 ? s.toFixed(1) + 's' : Math.floor(s / 60) + 'm ' + Math.round(s % 60) + 's'));
    }
    if (model) { const m = document.createElement('span'); m.className = 'mdl'; m.textContent = model; f.appendChild(m); }
    row.appendChild(f);
  }
  // ---- tool / bash / diff cards ----
  // Tool actions render as compact cards (a bash run, a diff, a file op) instead
  // of plain text — the "what the agent actually did" view. claude sends the
  // command and its output as SEPARATE messages; we merge the output into the
  // open bash card so it reads like one block (codex already sends them together).
  let openBash = null; // a bash card awaiting its output (claude's split result)
  function toolRow(prepend) {
    const row = document.createElement('div');
    row.className = 'msgRow tool';
    if (prepend) log.insertBefore(row, log.firstChild);
    else { log.appendChild(row); }
    return row;
  }
  // a 11px chevron that rotates when its card is open
  const CHEV = '<svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>';
  // Make a head row toggle a body element (chevron rotates, body hides). The body
  // starts collapsed for bash output (noisy), open for diffs (the point of the card).
  function makeCollapsible(head, body, startOpen) {
    head.classList.add('clickable');
    head.insertAdjacentHTML('afterbegin', CHEV);
    const set = (open) => { head.classList.toggle('open', open); body.hidden = !open; };
    set(startOpen);
    head.addEventListener('click', () => set(body.hidden));
  }
  function setOutput(card, output, exitCode) {
    let out = card.querySelector('.toolOut');
    if (!out) {
      out = document.createElement('pre'); out.className = 'toolOut toolBody';
      card.appendChild(out);
      makeCollapsible(card.querySelector('.toolHead'), out, false); // bash output folds away
    }
    out.textContent = output;
    if (typeof exitCode === 'number' && exitCode !== 0) card.classList.add('failed');
  }
  // Render a diff into the 'pre' element, showing only ±CTX lines around each
  // change and folding long unchanged runs into a "⋯" marker (OpenGUI-style). The
  // +/- gutter is a fixed-width column so code lines align. Returns {added,removed}.
  function renderDiff(pre, diffText) {
    const lines = diffText.split('\\n');
    const kind = lines.map((l) => (l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : 'ctx'));
    let added = 0, removed = 0;
    for (const k of kind) { if (k === 'add') added++; else if (k === 'del') removed++; }
    const CTX = 2;
    const keep = new Array(lines.length).fill(false);
    for (let i = 0; i < lines.length; i++) {
      if (kind[i] === 'ctx') continue;
      for (let c = Math.max(0, i - CTX); c <= Math.min(lines.length - 1, i + CTX); c++) keep[c] = true;
    }
    let folding = false;
    for (let i = 0; i < lines.length; i++) {
      if (!keep[i]) {
        if (!folding) { folding = true; const f = document.createElement('div'); f.className = 'fold'; f.textContent = '⋯'; pre.appendChild(f); }
        continue;
      }
      folding = false;
      const d = document.createElement('div'); d.className = kind[i];
      const sign = kind[i] === 'add' ? '+' : kind[i] === 'del' ? '−' : '';
      const text = lines[i].replace(/^[+\\-]/, '');
      d.innerHTML = '<span class="gut">' + sign + '</span>';
      d.appendChild(document.createTextNode(text || '\\u00A0'));
      pre.appendChild(d);
    }
    return { added, removed };
  }
  function renderTool(msg, prepend) {
    const t = msg.tool || {};
    // output-only result (claude) → fold into the open bash card
    if (t.command === undefined && t.diff === undefined && t.output && openBash && !prepend) {
      setOutput(openBash, t.output, t.exitCode);
      openBash = null;
      return;
    }
    const row = toolRow(prepend);
    if (t.command !== undefined) {
      const card = document.createElement('div'); card.className = 'toolCard bash';
      const head = document.createElement('div'); head.className = 'toolHead';
      head.innerHTML = '<span class="tk">$</span>';
      const cmd = document.createElement('span'); cmd.className = 'cmd'; cmd.textContent = t.command;
      head.appendChild(cmd); card.appendChild(head);
      if (t.output) setOutput(card, t.output, t.exitCode);
      else openBash = card; // wait for the result message
      row.appendChild(card);
    } else if (t.diff !== undefined) {
      const card = document.createElement('div'); card.className = 'toolCard diff';
      const head = document.createElement('div'); head.className = 'toolHead';
      head.innerHTML = '<span class="tk">✎</span>';
      const fn = document.createElement('span'); fn.className = 'file'; fn.textContent = t.file || 'edit';
      head.appendChild(fn);
      card.appendChild(head);
      const pre = document.createElement('pre'); pre.className = 'diffBody toolBody';
      const { added, removed } = renderDiff(pre, t.diff);
      const stat = document.createElement('span'); stat.className = 'stat';
      stat.innerHTML = '<span class="plus">+' + added + '</span><span class="minus">−' + removed + '</span>';
      head.appendChild(stat);
      card.appendChild(pre);
      makeCollapsible(head, pre, true); // diffs open by default — they're the point
      row.appendChild(card);
    } else {
      // file op / generic: a subtle one-liner
      const card = document.createElement('div'); card.className = 'toolCard op';
      const icon = t.name === 'Read' ? '📖' : t.name === 'Write' ? '✎' : '•';
      card.innerHTML = '<span class="icon">' + icon + '</span>';
      card.appendChild(document.createTextNode(msg.text || t.name || 'tool'));
      row.appendChild(card);
    }
    if (!prepend) { if (typingEl) log.appendChild(typingEl); log.scrollTop = log.scrollHeight; }
  }

  // ---- tool-approval card ----
  // When the engine needs a tool approved, render a green-accented card showing what
  // it wants to do (the command / file / diff) with [Approve] [Always] [Deny] buttons.
  // Clicking posts the decision back; the card then locks to show the resolution.
  function renderApproval(req) {
    const row = document.createElement('div');
    row.className = 'msgRow tool';
    const card = document.createElement('div');
    card.className = 'approvalCard';

    const head = document.createElement('div'); head.className = 'apHead';
    head.innerHTML = '<span class="apk">' + (req.kind === 'bash' ? '$' : req.kind === 'read' ? '📖' : '✎') + '</span>';
    const ttl = document.createElement('span'); ttl.className = 'apTitle'; ttl.textContent = req.title || req.tool;
    head.appendChild(ttl);
    const tag = document.createElement('span'); tag.className = 'apTag'; tag.textContent = req.cli;
    head.appendChild(tag);
    card.appendChild(head);

    // detail: command for bash, diff for edit, file for read/write
    if (req.command) {
      const pre = document.createElement('pre'); pre.className = 'apBody'; pre.textContent = req.command;
      card.appendChild(pre);
    } else if (req.diff) {
      const pre = document.createElement('pre'); pre.className = 'apBody diffBody';
      for (const ln of String(req.diff).split('\\n')) {
        const d = document.createElement('div');
        d.className = ln[0] === '+' ? 'add' : ln[0] === '-' ? 'del' : 'ctx';
        d.textContent = ln; pre.appendChild(d);
      }
      card.appendChild(pre);
    } else if (req.file) {
      const f = document.createElement('div'); f.className = 'apBody'; f.textContent = req.file;
      card.appendChild(f);
    }

    const actions = document.createElement('div'); actions.className = 'apActions';
    const decide = (outcome) => {
      vscode.postMessage({ type: 'approvalDecision', id: req.id, outcome });
      actions.remove();
      const done = document.createElement('div'); done.className = 'apResolved ' + (outcome === 'deny' ? 'denied' : 'allowed');
      done.textContent = outcome === 'deny' ? '✕ Denied' : outcome === 'always' ? '✓ Always allowed' : '✓ Approved';
      card.appendChild(done);
    };
    const mk = (label, outcome, cls) => {
      const b = document.createElement('button'); b.className = 'apBtn ' + cls; b.textContent = label;
      b.addEventListener('click', () => decide(outcome)); return b;
    };
    actions.appendChild(mk('Approve', 'once', 'ok'));
    actions.appendChild(mk('Always', 'always', 'always'));
    actions.appendChild(mk('Deny', 'deny', 'no'));
    card.appendChild(actions);

    row.appendChild(card);
    log.appendChild(row);
    if (typingEl) log.appendChild(typingEl);
    log.scrollTop = log.scrollHeight;
  }

  function onMessage(msg) {
    if (msg.role === 'tool') { renderTool(msg, false); return; }
    if (msg.role === 'summary') { renderSummary(msg.text, false); return; }
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
        const el = bubble(msg.role, false, badge);
        el.textContent = msg.text;
        if (msg.role === 'user') clampBody(el, el._row, 600);            // fold verbose prompts
        if (msg.role === 'assistant') addFooter(el._row, msg.durationMs, msg.model); // time + model
      }
    }
    if (typingEl) log.appendChild(typingEl); // keep the indicator at the bottom
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
  // ---- typing indicator (shown while the engine works, until turn end) ----
  let typingEl = null;
  function showTyping() {
    if (typingEl) return;
    const row = document.createElement('div');
    row.className = 'msgRow assistant';
    row.innerHTML = '<div class="msg assistant typing"><span class="who">' + cli
      + '</span><span class="dots"><i></i><i></i><i></i></span></div>';
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    typingEl = row;
  }
  function hideTyping() { if (typingEl) { typingEl.remove(); typingEl = null; } }

  function send() {
    const text = input.value.trim();
    if (!text) return;
    vscode.postMessage({ type: 'send', text });
    input.value = '';
    showTyping();
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
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'tool') renderTool(m, true);
      else if (m.role === 'summary') renderSummary(m.text, true);
      else {
        const badge = (m.role === 'assistant' && m.cli) ? m.cli : undefined;
        const el = bubble(m.role, true, badge);
        el.textContent = m.text;
        if (m.role === 'user') clampBody(el, el._row, 600);
        if (m.role === 'assistant') addFooter(el._row, m.durationMs, m.model);
      }
    }
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
    else if (m.type === 'clear') { log.innerHTML = ''; streaming = null; openBash = null; hideTyping(); resetPaging(); }
    else if (m.type === 'turnEnd') hideTyping();
    else if (m.type === 'platform') setTab(m.cli); // extension switched CLI (e.g. on session open)
    else if (m.type === 'storage') { renderStorage(m.info, m.options); renderWalletStorage(); }
    else if (m.type === 'cloudSync') renderCloudSync(m.status);
    else if (m.type === 'wallet') setWallet(m.address);
    else if (m.type === 'page') { hasMore = m.hasMore; pageCursor = m.cursor; }
    else if (m.type === 'older') {
      prependOlder(m.messages || []);
      hasMore = m.hasMore; pageCursor = m.cursor; loadingOlder = false;
    }
    else if (m.type === 'approval') renderApproval(m.req);
  });

  vscode.postMessage({ type: 'ready' });
  vscode.postMessage({ type: 'wallet' }); // fill the bottom-left wallet card on load
</script>
</body>
</html>`;
}
