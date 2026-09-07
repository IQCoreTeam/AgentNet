// Panel module cut from the legacy webview script (issue #215). Bodies are verbatim apart from
// the S.<name> state rewrite. Top-level statements live in wireComposer() because ESM evaluates
// modules in dependency order, and main.ts calls the wire functions in the legacy order so
// listener registration and boot posts keep their sequence.
import { S } from "./state.js";
import { vscode } from "./host.js";
import { approvalDock, composer, input, log } from "./dom.js";
import { renderEngineMissing, renderNotice, stickToBottom, syncWatermark } from "./shell.js";
import { completeSlash, renderSlashMenu, slashCommandsForCli } from "./slash.js";
import { effortByCli, fillModels, fillModes, modeByCli, modelByCli, selectTab } from "./engine.js";
import { tailBody } from "./turns.js";
import { closeMenus } from "./menus.js";
import { setSkills, skillsBtn, skillsPanel } from "./skills.js";
import { flashSkill } from "./overlays.js";

// ---- input ----
// ---- typing indicator (shown while the engine works, until turn end) ----
export function showTyping() {
  setBusy(true); // a turn is running → the Send button becomes Stop
  if (S.typingEl) return;
  const node = document.createElement('div');
  node.className = 'node typing';
  node.innerHTML = '<div class="typing"><span class="who">' + S.cli
    + '</span><span class="dots"><i></i><i></i><i></i></span></div>';
  tailBody().appendChild(node);
  stickToBottom();
  S.typingEl = node;
}
export function hideTyping() { setBusy(false); if (S.typingEl) { S.typingEl.remove(); S.typingEl = null; } }

// Send ⇄ Stop: while a turn runs, the primary button interrupts it (claude q.interrupt
// / codex turn/interrupt) instead of sending. The session survives — the next message
// continues the same conversation.
export function setBusy(b) {
  if (S.busy === b) return;
  S.busy = b;
  const btn = document.getElementById('send');
  if (!btn) return;
  const lbl = btn.querySelector('.lbl');
  if (lbl) lbl.textContent = b ? 'Stop' : 'Send';
  btn.title = b ? 'Stop' : 'Send';
  btn.setAttribute('aria-label', b ? 'Stop' : 'Send');
  btn.classList.toggle('stopping', b);
}
export function interruptTurn() {
  vscode.postMessage({ type: 'interrupt' });
  setBusy(false); // optimistic: drop the dots now; the engine's turnEnd confirms
  hideTyping();
}

// While a tool approval is pending, freeze the composer: the user must answer the
// approval before sending more. We DON'T clear what they've typed — input.value is
// left intact, just disabled — so a half-written message survives the wait. Called
// whenever the approval dock gains/loses a card. The send button mirrors the lock.
export const sendBtn = document.getElementById('send') as HTMLButtonElement;
export function syncComposerLock() {
  const locked = approvalDock.childElementCount > 0;
  input.disabled = locked;
  if (sendBtn) sendBtn.disabled = locked;
  composer.classList.toggle('locked', locked);
  input.placeholder = locked
    ? 'Answer the approval above to continue…'
    : 'Message ' + (composer.dataset.cli || 'claude') + '... (Enter to send)';
}

// ---- image attachments (paperclip / paste / drag-drop) ----
// each: { dataUrl, mime, dataBase64, name }. dataUrl drives the thumbnail + the live
// sent-bubble; {mime, dataBase64, name} is the payload posted to the host.
// images we just sent, held until the host echoes the user turn so we can paint the
// real thumbnails onto that bubble (base64 is never persisted, so history can't).
export const attachStrip = document.getElementById('attachStrip') as HTMLDivElement;
export const fileInput = document.getElementById('fileInput') as HTMLInputElement;
export const attachBtn = document.getElementById('attachBtn') as HTMLButtonElement;
export const inputWrap = document.getElementById('inputWrap') as HTMLDivElement;

export function renderAttachStrip() {
  attachStrip.innerHTML = '';
  attachStrip.style.display = S.attached.length ? 'flex' : 'none';
  S.attached.forEach((a, i) => {
    const t = document.createElement('div'); t.className = 'thumb';
    const img = document.createElement('img'); img.src = a.dataUrl; img.alt = a.name || 'image';
    const rm = document.createElement('button'); rm.className = 'rm'; rm.textContent = '×'; rm.title = 'Remove';
    rm.addEventListener('click', () => { S.attached.splice(i, 1); renderAttachStrip(); });
    t.appendChild(img); t.appendChild(rm); attachStrip.appendChild(t);
  });
}
// build the image row for a user bubble: live thumbs ({thumbs:[url]}) or a count chip
// ({count:N}) for replayed history where the base64 is gone.
export function userImagesEl(info) {
  if (!info) return null;
  if (info.thumbs && info.thumbs.length) {
    const row = document.createElement('div'); row.className = 'msgImgs';
    info.thumbs.forEach((u) => { const im = document.createElement('img'); im.src = u; row.appendChild(im); });
    return row;
  }
  if (info.count) {
    const chip = document.createElement('span'); chip.className = 'imgChip';
    chip.innerHTML = '<svg class="anic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m3.5 17 4.5-4.5 3.5 3.5 4-4 5 5"/></svg>' + info.count + (info.count > 1 ? ' images' : ' image');
    return chip;
  }
  return null;
}
export function addFiles(files) {
  for (const f of files) {
    if (!f.type || f.type.indexOf('image/') !== 0) continue; // images only
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const comma = dataUrl.indexOf(',');
      if (comma < 0) return;
      S.attached.push({ dataUrl, mime: f.type, dataBase64: dataUrl.slice(comma + 1), name: f.name || 'pasted' });
      renderAttachStrip();
    };
    reader.readAsDataURL(f);
  }
}

export function send() {
  if (input.disabled) return;       // frozen while an approval is pending
  const text = input.value.trim();
  if (!text && !S.attached.length) return; // nothing to send (no text, no images)
  // local slash commands handled in the webview (not sent to the agent).
  // /mockupskills [name ...]  → demo the "Casting" UI with the given skills (none = idle).
  if (text === '/mockupskills' || text.startsWith('/mockupskills ')) {
    const names = text.slice('/mockupskills'.length).trim().split(/\s+/).filter(Boolean);
    setSkills(names);
    if (skillsPanel.style.display === 'none') { skillsPanel.style.display = 'block'; skillsBtn.classList.add('on'); }
    input.value = '';
    return;
  }
  // /mockskill <name> -> demo the nft skill marquee
  if (text === '/mockskill' || text.startsWith('/mockskill ')) {
    flashSkill(text.slice('/mockskill'.length).trim() || 'cleancode', 'mock');
    input.value = '';
    return;
  }
  // ── real slash-command registry (local UI commands, not forwarded to the agent) ──
  if (text.startsWith('/')) {
    const [cmd, ...rest] = text.slice(1).split(' ');
    const arg = rest.join(' ').trim();
    switch (cmd) {
      case 'login': {
        const target = (arg === 'claude' || arg === 'codex') ? arg : S.cli;
        if (target === 'claude' && arg && arg !== 'claude' && arg !== 'codex') {
          vscode.postMessage({ type: 'claudeAuthCode', code: arg });
          renderNotice('Submitted Claude sign-in code.');
        } else {
          vscode.postMessage({ type: target === 'claude' ? 'startClaudeLogin' : 'startCodexLogin' });
          renderNotice('Starting ' + (target === 'claude' ? 'Claude' : 'Codex') + ' sign-in...');
        }
        input.value = ''; return;
      }
      case 'logout': {
        const target = (arg === 'claude' || arg === 'codex') ? arg : S.cli;
        vscode.postMessage({ type: 'logoutEngine', cli: target });
        renderNotice('Signing out of ' + (target === 'claude' ? 'Claude' : 'Codex') + '...');
        input.value = ''; return;
      }
      case 'new':
        vscode.postMessage({ type: 'new' });
        input.value = ''; return;
      case 'clear':
        vscode.postMessage({ type: 'clear' });
        input.value = ''; return;
      case 'compact':
        vscode.postMessage({ type: 'slashCommand', command: 'compact', arg });
        showTyping();
        input.value = ''; return;
      case 'status':
        vscode.postMessage({ type: 'slashCommand', command: 'status' });
        input.value = ''; return;
      case 'resume':
        vscode.postMessage({ type: 'slashCommand', command: 'resume' });
        input.value = ''; return;
      case 'diff':
        vscode.postMessage({ type: 'slashCommand', command: 'diff' });
        showTyping();
        input.value = ''; return;
      case 'permissions':
        if (arg) { modeByCli[S.cli] = arg; fillModes(); vscode.postMessage({ type: 'mode', mode: arg }); }
        else vscode.postMessage({ type: 'slashCommand', command: 'permissions' });
        input.value = ''; return;
      case 'init':
      case 'skills':
      case 'cost':
        vscode.postMessage({ type: 'slashCommand', command: cmd });
        input.value = ''; return;
      case 'review':
      case 'mcp':
        vscode.postMessage({ type: 'slashCommand', command: cmd, arg });
        showTyping();
        input.value = ''; return;
      case 'copy': {
        const last = Array.from(log.querySelectorAll('.node.assistant .msg')).pop();
        if (last && navigator.clipboard) navigator.clipboard.writeText(last.textContent || '').catch(() => {});
        input.value = ''; return;
      }
      case 'engine':
        if (arg === 'claude' || arg === 'codex') selectTab(arg);
        input.value = ''; return;
      case 'model':
        if (arg) { modelByCli[S.cli] = arg; fillModels(); vscode.postMessage({ type: 'model', model: arg }); }
        input.value = ''; return;
      case 'mode':
        if (arg) { modeByCli[S.cli] = arg; fillModes(); vscode.postMessage({ type: 'mode', mode: arg }); }
        input.value = ''; return;
      case 'effort':
        if (arg) { effortByCli[S.cli] = arg; fillModes(); vscode.postMessage({ type: 'effort', effort: arg === 'default' ? undefined : arg }); }
        input.value = ''; return;
      case 'help': {
        const helpText = slashCommandsForCli()
          .map(function(c) { return '/' + c.name + (c.args ? ' ' + c.args : '') + ' - ' + c.desc; })
          .join('\n');
        const pre = document.createElement('pre');
        pre.style.cssText = 'margin:8px 0;padding:8px 12px;background:var(--an-bg-1);border-radius:6px;font-size:0.82em;opacity:0.8';
        pre.textContent = helpText;
        log.appendChild(pre); syncWatermark();
        input.value = ''; return;
      }
      default: {
        // Let native Claude/Codex slash commands, custom skills, and MCP prompts run
        // instead of blocking them in AgentNet's autocomplete layer.
        vscode.postMessage({ type: 'slashCommand', command: cmd, arg });
        showTyping();
        input.value = ''; return;
      }
    }
  }
  const activeStatus = S.cliReport && S.cliReport[S.cli];
  if (activeStatus === 'missing') {
    renderEngineMissing(S.cli);
    return;
  }
  if (activeStatus === 'no-login') {
    renderNotice((S.cli === 'claude' ? 'Claude' : 'Codex') + ' is not signed in. Type /login to connect it.');
    return;
  }
  const images = S.attached.map((a) => ({ mime: a.mime, dataBase64: a.dataBase64, name: a.name }));
  S.pendingSentImages = S.attached.map((a) => a.dataUrl); // painted onto the echoed bubble
  vscode.postMessage({ type: 'send', text, images });
  S.attached = []; renderAttachStrip();
  input.value = '';
  input.style.height = 'auto'; // collapse back to one row after sending
  showTyping();
}
// Grow the textarea with its content; CSS max-height (~2.5x) then scrolls inside.
// Reset to auto first so it shrinks when text is deleted; pasting a long message
// grows to the cap and scrolls rather than pushing the chat off-screen.
// Coalesced to one measure per frame: the auto+scrollHeight pair forces a synchronous
// relayout, and doing that per keystroke lands exactly when a streaming flush has just
// dirtied the transcript layout — each key then re-laid-out the whole document, which
// is what made typing stutter while a reply streamed.
export function autoGrowInput() {
  if (S.growRaf) return;
  S.growRaf = requestAnimationFrame(() => {
    S.growRaf = 0;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 220) + 'px';
  });
}

export function wireComposer() {
  attachBtn.addEventListener('click', () => { if (!input.disabled) fileInput.click(); });
  fileInput.addEventListener('change', () => { addFiles(fileInput.files || []); fileInput.value = ''; });
  // paste an image straight from the clipboard
  input.addEventListener('paste', (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    const imgs = [];
    for (const it of items) { if (it.kind === 'file' && it.type.indexOf('image/') === 0) { const f = it.getAsFile(); if (f) imgs.push(f); } }
    if (imgs.length) { e.preventDefault(); addFiles(imgs); }
  });
  // drag an image file onto the composer
  ['dragenter', 'dragover'].forEach((ev) => inputWrap.addEventListener(ev, (e: DragEvent) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0) {
      e.preventDefault(); inputWrap.classList.add('dragover');
    }
  }));
  ['dragleave', 'drop'].forEach((ev) => inputWrap.addEventListener(ev, (e: DragEvent) => {
    if (ev === 'drop') { e.preventDefault(); if (e.dataTransfer) addFiles(e.dataTransfer.files || []); }
    inputWrap.classList.remove('dragover');
  }));
  // the primary button sends when idle, interrupts when a turn is running
  document.getElementById('send').addEventListener('click', () => { S.busy ? interruptTurn() : send(); });
  document.getElementById('newBtn').addEventListener('click', () => { vscode.postMessage({ type: 'new' }); closeMenus(); });
  document.getElementById('newTabBtn').addEventListener('click', () => vscode.postMessage({ type: 'newTab' }));
  input.addEventListener('keydown', (e) => {
    // e.isComposing = IME (Korean/Japanese/Chinese) mid-composition; don't send
    // a half-formed syllable. keyCode 229 is the legacy IME-in-progress signal.
    if (e.isComposing || e.keyCode === 229) return;

    if (S.activeSlashMatches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        S.slashIdx = (S.slashIdx + 1) % S.activeSlashMatches.length;
        renderSlashMenu();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        S.slashIdx = (S.slashIdx - 1 + S.activeSlashMatches.length) % S.activeSlashMatches.length;
        renderSlashMenu();
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        if (S.activeSlashMatches[S.slashIdx]) {
          completeSlash(S.activeSlashMatches[S.slashIdx]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        S.suppressSlash = true;
        renderSlashMenu();
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === 'Escape' && S.busy) { e.preventDefault(); interruptTurn(); } // Esc stops the turn
  });
  // Esc interrupts the running turn (Claude-Code style) even when the input isn't focused
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.busy) { e.preventDefault(); interruptTurn(); } });
  input.addEventListener('input', () => {
    autoGrowInput();
    S.suppressSlash = false;
    S.slashIdx = 0;
    renderSlashMenu();
  });
}
