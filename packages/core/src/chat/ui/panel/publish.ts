// Panel module cut from the legacy webview script (issue #215). Bodies are verbatim apart from
// the S.<name> state rewrite. Top-level statements live in wirePublish() because ESM evaluates
// modules in dependency order, and main.ts calls the wire functions in the legacy order so
// listener registration and boot posts keep their sequence.
import { S } from "./state.js";
import { vscode } from "./host.js";
import { looksOnChain } from "./format.js";
import { showView } from "./views.js";

// ---- make-skill: publish form (issue: author + publish a skill from the UI) ----
export const pubImage = document.getElementById('pubImage') as HTMLInputElement;
export const pubImageBadge = document.getElementById('pubImageBadge') as HTMLDivElement;
export const pubSubmit = document.getElementById('pubSubmit') as HTMLButtonElement;
export const pubError = document.getElementById('pubError') as HTMLDivElement;
// ── workflow builder: skill/workflow toggle + owned-skill picker ──────────
// A workflow is defined by the skills it requires (the on-chain gate). Workflow mode hides
// the SKILL.md body and shows a checklist of skills you own; on submit we synthesize the
// frontmatter (type: workflow + requiredSkills) so the current backend mints it as a
// workflow, and also send kind/requiredSkills for the newer contract path (forward-compat).
// Armed by a short-body publish attempt so a second click confirms the permanent mint (see pubSubmit).
export const pubFormEl = document.getElementById('pubForm') as HTMLDivElement;
export const pubTextWrap = document.getElementById('pubTextWrap') as HTMLDivElement;
export const pubReqWrap = document.getElementById('pubReqWrap') as HTMLDivElement;
export const pubReqEl = document.getElementById('pubReq') as HTMLDivElement;
export const pubReqCountEl = document.getElementById('pubReqCount') as HTMLDivElement;
export const pubReqSel = {}; // mint -> selected
export function chosenReqMints() { return Object.keys(pubReqSel).filter((m) => pubReqSel[m]); }
export function updatePubReqCount() {
  const c = chosenReqMints().length;
  pubReqCountEl.textContent = c ? (c + ' selected' + (c > 16 ? ' \u2014 max 16, deselect some' : '')) : '';
}
export function renderPubReq() {
  // Only real on-chain SKILLS qualify: the gate requires official-skills-collection members, so
  // a mint must exist AND not itself be a workflow (a workflow can't require another workflow).
  const owned = S.ownedSkills.filter((n) => !!S.skillMints[n] && !S.workflowMintSet.has(S.skillMints[n]));
  if (!owned.length) {
    pubReqEl.innerHTML = '<div class="empty">You don\'t own any skills yet. Buy at least one before publishing a workflow.</div>';
    pubReqCountEl.textContent = '';
    return;
  }
  pubReqEl.innerHTML = '';
  for (const n of owned) {
    const mint = S.skillMints[n];
    const lab = document.createElement('label');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = mint; cb.checked = !!pubReqSel[mint];
    cb.addEventListener('change', () => { pubReqSel[mint] = cb.checked; updatePubReqCount(); });
    const span = document.createElement('span'); span.textContent = n;
    lab.appendChild(cb); lab.appendChild(span); pubReqEl.appendChild(lab);
  }
  updatePubReqCount();
}
export function setPubKind(k) {
  S.pubKind = (k === 'workflow') ? 'workflow' : 'skill';
  S.pubBodyConfirmed = false; // fresh view/kind: re-require confirm for an empty body
  const wf = S.pubKind === 'workflow';
  for (const b of document.querySelectorAll('.pubKind button')) b.classList.toggle('on', b.getAttribute('data-k') === S.pubKind);
  pubFormEl.classList.toggle('wf', wf);
  pubTextWrap.style.display = wf ? 'none' : '';
  pubReqWrap.style.display = wf ? '' : 'none';
  document.getElementById('pubFormHead').innerHTML = 'FORM // <b>PUBLISH ' + (wf ? 'WORKFLOW' : 'SKILL') + '</b>';
  document.getElementById('pubViewTitle').textContent = wf ? 'Make a workflow' : 'Make a skill';
  document.getElementById('pubViewDesc').textContent = wf
    ? 'Bundle skills you own into one workflow. Buyers must hold every skill it requires to unlock it.'
    : 'Publish a skill others can buy. It mints a soulbound NFT and the body is stored on-chain.';
  if (!pubSubmit.disabled) pubSubmit.textContent = wf ? 'Publish workflow' : 'Publish skill';
  if (wf) renderPubReq();
}
export function openPublish(kind) { setPubKind(kind); showView('publish'); }

export function wirePublish() {
  for (const b of document.querySelectorAll('.pubKind button')) b.addEventListener('click', () => setPubKind(b.getAttribute('data-k')));
  pubImage.addEventListener('input', () => {
    pubImageBadge.style.display = looksOnChain(pubImage.value) ? 'inline-block' : 'none';
  });
  document.getElementById('pubText').addEventListener('input', () => { S.pubBodyConfirmed = false; }); // re-arm the empty-body guard when the body changes
  pubSubmit.addEventListener('click', () => {
    const name = (document.getElementById('pubName') as HTMLInputElement).value.trim();
    const description = (document.getElementById('pubDesc') as HTMLTextAreaElement).value.trim();
    const priceSol = (document.getElementById('pubPrice') as HTMLInputElement).value.trim();
    const category = (document.getElementById('pubCategory') as HTMLInputElement).value.trim();
    const hashtags = (document.getElementById('pubHashtags') as HTMLInputElement).value.split(',').map(h => h.trim()).filter(Boolean);
    const image = pubImage.value.trim();
    pubError.style.display = 'none';
    const fail = (msg) => { pubError.textContent = msg; pubError.style.display = 'block'; };
    if (!name) return fail('Name is required.');
    if (!description) return fail('Description is required.');
    let text; let reqMints = [];
    if (S.pubKind === 'workflow') {
      // Drop any workflow mint that slipped through (the gate rejects a workflow as a required skill).
      reqMints = chosenReqMints().filter((m) => !S.workflowMintSet.has(m));
      if (!reqMints.length) return fail('Pick at least one skill this workflow requires.');
      if (reqMints.length > 16) return fail('A workflow can require at most 16 skills.');
      // Synthesize the SKILL.md so the current backend (frontmatter sniff) mints a workflow;
      // requiredSkills carries the chosen skill mints (base58) the on-chain gate checks.
      const fm = ['---', 'name: ' + name, 'description: ' + description.replace(/\s*\n\s*/g, ' '),
                  'type: workflow', 'requiredSkills: [' + reqMints.join(', ') + ']'];
      if (category) fm.push('category: ' + category);
      if (hashtags.length) fm.push('hashtags: [' + hashtags.join(', ') + ']');
      text = fm.concat(['---', '', '# ' + name, '', description, '']).join('\n');
    } else {
      text = (document.getElementById('pubText') as HTMLTextAreaElement).value.trim();
      if (!text) return fail('Skill text is required.');
      // A near-empty body mints permanently and can't be deleted. Gauge the real body by
      // dropping any leading --- frontmatter block + whitespace, then require an explicit
      // second click (not a hard block) if it still looks empty or very short.
      const body = text.replace(/^---[\s\S]*?\n---\s*/, '').trim();
      if (body.length < 20 && !S.pubBodyConfirmed) {
        S.pubBodyConfirmed = true;
        return fail('This publishes PERMANENTLY and cannot be deleted; the body looks empty or very short. Click Publish again to submit anyway.');
      }
    }
    if (!priceSol) return fail('Enter a price in SOL (use 0 for free).');
    if (!/^\d+(\.\d+)?$/.test(priceSol)) return fail('Price must be a number in SOL (e.g. 0.1).');
    pubSubmit.disabled = true; pubSubmit.textContent = 'Publishing…';
    const msg: any = {
      type: 'publishSkill', name, description, text, priceSol,
      category: category || undefined,
      hashtags: hashtags.length ? hashtags : undefined,
      image: image || undefined,
    };
    if (S.pubKind === 'workflow') { msg.kind = 'workflow'; msg.requiredSkills = reqMints; }
    vscode.postMessage(msg);
  });
}
