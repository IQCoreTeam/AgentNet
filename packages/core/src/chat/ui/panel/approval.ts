// Panel module cut from the legacy webview script (issue #215). Bodies are verbatim apart from
// the S.<name> state rewrite.
import { vscode } from "./host.js";
import { approvalDock } from "./dom.js";
import { syncComposerLock } from "./composer.js";

// ---- tool-approval card ----
// When the engine needs a tool approved, render a green-accented card showing what
// it wants to do (the command / file / diff) with [Approve] [Always] [Deny] buttons.
// Clicking posts the decision back; the card then locks to show the resolution.
// Remove an approval card by request id — used when the decision was made on another surface
// (the macOS desktop popup answered it), so the now-stale on-screen card clears itself.
export function dismissApproval(id) {
  const cards = approvalDock.querySelectorAll<HTMLElement>('[data-approval-id]');
  for (const c of cards) { if (c.dataset.approvalId === id) { c.remove(); syncComposerLock(); break; } }
}
export function renderApproval(req) {
  const card = document.createElement('div');
  card.className = 'approvalCard';
  card.dataset.approvalId = req.id; // so the host can dismiss THIS card if answered elsewhere (desktop popup)
  // Skill MARKET approvals get the "forge" treatment — a tinted card with a soft glow +
  // a few slow twinkles. Publishing (make) glows violet; buying glows gold (the collectible
  // accent), so acquiring a skill feels like opening a treasure. Every other approval stays
  // the green card.
  const isPublish = /publish_skill/.test(req.tool || '') || /publish_skill/.test(req.title || '');
  const isBuy = /buy_skill/.test(req.tool || '') || /buy_skill/.test(req.title || '');
  const isForge = isPublish || isBuy;
  if (isForge) {
    card.classList.add('skillForge');
    if (isBuy) card.classList.add('buyForge'); // gold variant
    const stars = document.createElement('div'); stars.className = 'forgeStars';
    for (let i = 0; i < 6; i++) {
      const s = document.createElement('span'); s.className = 'st'; s.innerHTML = '<svg class="anic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2 14.4 9.6 22 12 14.4 14.4 12 22 9.6 14.4 2 12 9.6 9.6Z"/></svg>';
      s.style.left = (8 + Math.random() * 84) + '%';
      s.style.top = (12 + Math.random() * 70) + '%';
      s.style.animationDuration = (3.2 + Math.random() * 2.4) + 's';
      s.style.animationDelay = (Math.random() * 3) + 's';
      s.style.fontSize = (7 + Math.random() * 5) + 'px';
      stars.appendChild(s);
    }
    card.appendChild(stars);
  }

  // ── AskUserQuestion: a choice/free-text prompt (claude/codex both route here). The
  // user's answer becomes the tool result, so this card renders options as chips plus
  // an optional input field and sends structured questionResponses — no Approve/Deny.
  if (req.kind === 'question' && Array.isArray(req.questions) && req.questions.length) {
    // Stepper: when several questions pile up, show ONE at a time with a "1 / N" counter.
    // Answering advances to the next; the last one's button sends all accumulated answers.
    const sel = {}; // qIndex → array of chosen labels
    const free = {}; // qIndex → typed answer
    const total = req.questions.length;
    let step = 0;
    const hasAnswer = (qi) => {
      const typed = (free[qi] || '').trim();
      return typed.length > 0 || !!(sel[qi] && sel[qi].length);
    };
    const sendAll = () => {
      const questionResponses = req.questions.map((q, qi) => {
        const typed = (free[qi] || '').trim();
        return {
          question: q.question,
          questionId: q.id,
          selected: typed ? [] : (sel[qi] || []),
          ...(typed ? { text: typed } : {}),
        };
      });
      vscode.postMessage({ type: 'approvalDecision', id: req.id, outcome: 'once', questionResponses });
      card.remove(); syncComposerLock();
    };
    const renderStep = () => {
      card.innerHTML = '';
      const q = req.questions[step];
      let updateNext = () => {};
      let otherInput = null;
      if (total > 1) {
        const counter = document.createElement('div'); counter.className = 'qCount';
        counter.textContent = (step + 1) + ' / ' + total;
        card.appendChild(counter);
      }
      const block = document.createElement('div'); block.className = 'qBlock';
      if (q.header) { const h = document.createElement('span'); h.className = 'qHeader'; h.textContent = q.header; block.appendChild(h); }
      const qt = document.createElement('div'); qt.className = 'qText'; qt.textContent = q.question; block.appendChild(qt);
      const opts = document.createElement('div'); opts.className = 'qOpts';
      (q.options || []).forEach((opt) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'qOpt';
        if ((sel[step] || []).indexOf(opt.label) >= 0) b.classList.add('on');
        const t = document.createElement('div'); t.className = 'qOptLabel'; t.textContent = opt.label; b.appendChild(t);
        if (opt.description) { const d = document.createElement('div'); d.className = 'qOptDesc'; d.textContent = opt.description; b.appendChild(d); }
        b.addEventListener('click', () => {
          const cur = sel[step] || [];
          delete free[step];
          if (q.multiSelect) {
            sel[step] = cur.indexOf(opt.label) >= 0 ? cur.filter((l) => l !== opt.label) : cur.concat(opt.label);
          } else {
            sel[step] = cur[0] === opt.label ? [] : [opt.label];
          }
          Array.from(opts.children).forEach((c, i) => c.classList.toggle('on', (sel[step] || []).indexOf((q.options[i] || {}).label) >= 0));
          if (otherInput) otherInput.value = '';
          updateNext();
        });
        opts.appendChild(b);
      });
      block.appendChild(opts);
      if (q.allowCustomInput) {
        const label = document.createElement('div');
        label.className = 'qOtherLabel';
        label.textContent = q.options && q.options.length ? 'Or type your own answer' : 'Type your answer';
        block.appendChild(label);
        otherInput = q.secret ? document.createElement('input') : document.createElement('textarea');
        otherInput.className = 'qOtherInput';
        otherInput.placeholder = 'Type your answer…';
        if (q.secret) otherInput.type = 'password';
        else otherInput.rows = 3;
        if (free[step]) otherInput.value = free[step];
        otherInput.addEventListener('input', () => {
          free[step] = otherInput.value;
          sel[step] = [];
          Array.from(opts.children).forEach((c) => c.classList.remove('on'));
          updateNext();
        });
        block.appendChild(otherInput);
      }
      card.appendChild(block);
      const actions = document.createElement('div'); actions.className = 'apActions';
      if (step > 0) {
        const back = document.createElement('button'); back.className = 'apBtn always'; back.textContent = 'Back';
        back.addEventListener('click', () => { step -= 1; renderStep(); });
        actions.appendChild(back);
      }
      const next = document.createElement('button'); next.className = 'apBtn ok';
      const last = step === total - 1;
      next.textContent = last ? 'Send' : 'Next';
      next.addEventListener('click', () => {
        if (!hasAnswer(step)) return;
        if (last) sendAll(); else { step += 1; renderStep(); }
      });
      actions.appendChild(next);
      card.appendChild(actions);
      updateNext = () => { next.disabled = !hasAnswer(step); };
      updateNext();
    };
    renderStep();
    approvalDock.insertBefore(card, approvalDock.firstChild);
    syncComposerLock();
    return;
  }

  // ── plan / bash / edit / read / write: a yes-or-no permission card ──
  const isPlan = req.kind === 'plan';
  const isDanger = req.risk === 'danger';
  const head = document.createElement('div'); head.className = 'apHead' + (isDanger ? ' apDanger' : '');
  const glyphEl = document.createElement('span'); glyphEl.className = 'apk';
  var skSvg = '<svg class="anic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2 14.4 9.6 22 12 14.4 14.4 12 22 9.6 14.4 2 12 9.6 9.6Z"/></svg>';
  var rdSvg = '<svg class="anic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h7l5 5v13H6Z"/><path d="M13 3v5h5"/><path d="M9 13h6M9 16.5h6"/></svg>';
  glyphEl.innerHTML = req.kind === 'bash' ? '$' : req.kind === 'read' ? rdSvg : isPlan ? skSvg : isForge ? skSvg : '✎';
  head.appendChild(glyphEl);
  if (isDanger) {
    const warn = document.createElement('span'); warn.style.cssText = 'color:var(--vscode-errorForeground,#f44);font-weight:700;margin-right:4px';
    warn.innerHTML = '<svg class="anic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 21 19.5H3L12 3.5Z"/><path d="M12 10v4"/><path d="M12 17h.01"/></svg> DANGER ·'; head.appendChild(warn);
  }
  const ttl = document.createElement('span'); ttl.className = 'apTitle';
  ttl.textContent = isPublish ? ('Forge skill: ' + ((req.input && req.input.name) || 'new skill'))
    : isBuy ? ('Buy skill' + ((req.input && req.input.name) ? (': ' + req.input.name) : ''))
    : (req.title || req.tool);
  head.appendChild(ttl);
  const tag = document.createElement('span'); tag.className = 'apTag'; tag.textContent = req.cli;
  head.appendChild(tag);
  card.appendChild(head);

  // detail: command for bash (editable), plan text for plan, diff for edit, file for read/write
  let commandInput = null; // textarea for bash edit mode
  if (req.command) {
    const pre = document.createElement('pre'); pre.className = 'apBody'; pre.textContent = req.command;
    card.appendChild(pre);
    // bash: allow editing the command before approving
    if (req.kind === 'bash') {
      commandInput = document.createElement('textarea');
      commandInput.className = 'apBody';
      commandInput.style.cssText = 'display:none;width:100%;box-sizing:border-box;resize:vertical;font-family:monospace;font-size:0.85em;background:var(--an-bg-1);border:1px solid var(--eng);border-radius:4px;padding:6px;color:inherit';
      commandInput.value = req.command;
      card.appendChild(commandInput);
      const PENCIL_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
      const XMARK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
      const editBtn = document.createElement('button'); editBtn.className = 'apEdit';
      editBtn.innerHTML = PENCIL_SVG; editBtn.title = 'Edit'; editBtn.setAttribute('aria-label', 'Edit');
      editBtn.addEventListener('click', () => {
        const editing = commandInput.style.display !== 'none';
        pre.style.display = editing ? '' : 'none';
        commandInput.style.display = editing ? 'none' : '';
        editBtn.innerHTML = editing ? PENCIL_SVG : XMARK_SVG;
        editBtn.title = editing ? 'Edit' : 'Cancel';
      });
      head.appendChild(editBtn);
    }
  } else if (req.plan) {
    const pre = document.createElement('pre'); pre.className = 'apBody planBody'; pre.textContent = req.plan;
    card.appendChild(pre);
  } else if (req.diff) {
    const pre = document.createElement('pre'); pre.className = 'apBody diffBody';
    for (const ln of String(req.diff).split('\n')) {
      const d = document.createElement('div');
      d.className = ln[0] === '+' ? 'add' : ln[0] === '-' ? 'del' : 'ctx';
      d.textContent = ln; pre.appendChild(d);
    }
    card.appendChild(pre);
  } else if (req.file) {
    const f = document.createElement('div'); f.className = 'apBody'; f.textContent = req.file;
    card.appendChild(f);
  } else if (isPublish && req.input) {
    // show WHAT is being forged: name + description + price, so the approval is meaningful
    const box = document.createElement('div'); box.className = 'apBody forgeBody';
    const nm = document.createElement('div'); nm.style.cssText = 'font-weight:600;font-size:1.02em'; nm.textContent = req.input.name || 'new skill';
    box.appendChild(nm);
    if (req.input.description) {
      const d = document.createElement('div'); d.style.cssText = 'opacity:0.85;font-size:0.85em;margin-top:2px'; d.textContent = req.input.description; box.appendChild(d);
    }
    const priceSol = req.input.priceSol;
    const priceTxt = priceSol == null ? '0.1 SOL' : String(priceSol) === '0' ? 'free' : priceSol + ' SOL';
    const meta = document.createElement('div'); meta.style.cssText = 'margin-top:5px;font-size:0.8em;opacity:0.7'; meta.textContent = 'mint a soulbound NFT · price ' + priceTxt;
    box.appendChild(meta);
    card.appendChild(box);
  }

  const actions = document.createElement('div'); actions.className = 'apActions';
  const decide = (outcome, extra?) => {
    vscode.postMessage({ type: 'approvalDecision', id: req.id, outcome, ...extra });
    card.remove(); // answered → clear it from the dock
    syncComposerLock(); // unfreeze once the last pending approval is answered
  };
  const mk = (label, outcome, cls) => {
    const b = document.createElement('button'); b.className = 'apBtn ' + cls; b.textContent = label;
    b.addEventListener('click', () => decide(outcome)); return b;
  };

  if (isPlan) {
    // plan has no "Always" and no edit/deny-reason
    actions.appendChild(mk('Approve plan', 'once', 'ok'));
    actions.appendChild(mk('Keep planning', 'deny', 'no'));
  } else {
    actions.appendChild(mk('Approve', 'once', 'ok'));
    actions.appendChild(mk('Always', 'always', 'always'));

    // bash: "Approve edited" (visible only when edit mode is active)
    let approveEdited = null;
    if (req.kind === 'bash' && commandInput) {
      approveEdited = document.createElement('button');
      approveEdited.className = 'apBtn ok'; approveEdited.textContent = 'Approve edited';
      approveEdited.style.display = 'none';
      approveEdited.addEventListener('click', () => {
        decide('once', { updatedInput: { ...(req.input ?? {}), command: commandInput.value } });
      });
      actions.appendChild(approveEdited);
      // sync visibility with the edit toggle button in the header
      const editToggle = head.querySelector('button');
      if (editToggle) {
        editToggle.addEventListener('click', () => {
          const isEditing = commandInput.style.display !== 'none';
          if (approveEdited) approveEdited.style.display = isEditing ? '' : 'none';
        });
      }
    }

    // deny-with-reason: clicking Deny reveals a reason input; the reason row's Deny sends
    const reasonRow = document.createElement('div');
    reasonRow.style.cssText = 'display:none;gap:6px;margin-top:4px;align-items:center;flex-wrap:wrap';
    const reasonInput = document.createElement('input'); reasonInput.type = 'text';
    reasonInput.placeholder = 'Reason for denying (optional)';
    reasonInput.style.cssText = 'flex:1;min-width:120px;background:var(--an-bg-1);border:1px solid var(--an-line);border-radius:4px;padding:4px 8px;font-size:0.82em;color:inherit;outline:none';
    const confirmDeny = document.createElement('button'); confirmDeny.className = 'apBtn no'; confirmDeny.textContent = 'Deny';
    confirmDeny.addEventListener('click', () => decide('deny', { reason: reasonInput.value.trim() || undefined }));
    const cancelDeny = document.createElement('button'); cancelDeny.className = 'apBtn'; cancelDeny.textContent = '↩';
    cancelDeny.style.cssText = 'opacity:0.6'; cancelDeny.addEventListener('click', () => { reasonRow.style.display = 'none'; });
    reasonRow.appendChild(reasonInput); reasonRow.appendChild(confirmDeny); reasonRow.appendChild(cancelDeny);

    // Deny button: first click reveals reason row; doesn't call decide() directly
    const denyBtn = document.createElement('button'); denyBtn.className = 'apBtn no'; denyBtn.textContent = 'Deny';
    denyBtn.addEventListener('click', () => {
      reasonRow.style.display = 'flex';
      reasonInput.focus();
    });
    actions.appendChild(denyBtn);
    card.appendChild(actions);
    card.appendChild(reasonRow);
  }

  if (isPlan) card.appendChild(actions);

  // keyboard: ← → move focus between action buttons, Enter/Space activates focused button.
  card.addEventListener('keydown', (e) => {
    const btnsAll = Array.from(actions.querySelectorAll('button'));
    const i = btnsAll.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); btnsAll[(i + 1) % btnsAll.length].focus(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); btnsAll[(i + btnsAll.length - 1) % btnsAll.length].focus(); }
  });

  // dock it just above the composer (newest on top), not inside the scrolling log
  approvalDock.insertBefore(card, approvalDock.firstChild);
  syncComposerLock(); // freeze the input while this (and any other) approval is open
  // Default focus = Approve so Enter approves right away — BUT only when THIS panel is
  // the one the user is actually in. Each VSCode webview is its own document, so an
  // approval popping in a BACKGROUND session would otherwise yank focus out of the
  // panel the user is typing in. document.hasFocus() is false for that background
  // webview, so we skip the auto-focus there and leave the active panel alone.
  if (document.hasFocus()) { const first = actions.querySelector('button'); if (first) first.focus(); }
}
