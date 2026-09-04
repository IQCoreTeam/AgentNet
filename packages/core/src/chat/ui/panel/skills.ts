// Panel module cut from the legacy webview script (issue #215). Bodies are verbatim apart from
// the S.<name> state rewrite. Top-level statements live in wireSkills() because ESM evaluates
// modules in dependency order, and main.ts calls the wire functions in the legacy order so
// listener registration and boot posts keep their sequence.
import { S } from "./state.js";
import { WAND_SVG } from "../icons.js";
import { skillSigilSvg } from "../skillSigil.js";
import { vscode } from "./host.js";
import { openDetail, openSkillDoc } from "./market.js";
import { pubReqWrap, renderPubReq } from "./publish.js";
import { showView } from "./views.js";

// equipped-skills panel: inline toggle above the composer (not an absolute dropdown)
export const skillsBtn = document.getElementById('skillsBtn');
export const skillsPanel = document.getElementById('skillsPanel');
export function closeSkillsPanel() { skillsPanel.style.display = 'none'; skillsBtn.classList.remove('on'); }
// explicit close (×) on the panel header — the panel was un-dismissable before
export const skillsCloseBtn = document.getElementById('skillsClose');

// wallet-menu "Skills" entry → expand an INLINE, scrollable list of owned skills right
// here in the dropdown. No buy / no page jump (purchases live in the Markets tab); just
// "what do I own". Clicking again collapses it.
export const walletSkillsItem = document.getElementById('walletSkills');
export const walletSkillList = document.getElementById('walletSkillList');
export function renderWalletSkillList() {
  if (!walletSkillList) return;
  walletSkillList.innerHTML = '';
  if (!S.ownedSkills.length) {
    const e = document.createElement('div'); e.className = 'wskEmpty';
    e.textContent = 'No skills yet. Buy them in Markets.';
    walletSkillList.appendChild(e);
    return;
  }
  for (const name of S.ownedSkills) {
    const row = document.createElement('div'); row.className = 'wskRow';
    row.innerHTML = '<span class="wand">' + WAND_SVG + '</span>';
    const lbl = document.createElement('span'); lbl.textContent = name; lbl.title = name;
    row.appendChild(lbl); row.style.cursor = 'pointer';
    // NFT skills (have a mint) -> the market detail view, which has the comment box
    // (the popup modal doesn't). Bundled skills (no mint) -> the local SKILL.md doc.
    row.addEventListener('click', () => { const mt = S.skillMints[name]; if (mt) { showView('market'); openDetail(mt); } else openSkillDoc(name); });
    walletSkillList.appendChild(row);
  }
}
// The agent's OWNED skills (array of names) — everything owned is "active" (no
// separate active state). Renders each as an item card in the panel; empty slots
// fill the rest. No count badge (ownership is the whole point, not a number).
// Build a skill as an "SD-card" collectible (ported from the React surface). One component
// used everywhere skills are listed. card: { name, id, category?, type?, price?, supply? }.
// opts: { owned, disposed, firing, dim, onOpen }. The whole card is the click target (opens
// detail); buying happens there, so there is no inline buy button.
export function skillSdCard(card, opts) {
  opts = opts || {};
  const isWorkflow = card.type === 'workflow';
  const priceSol = (card.price && card.price !== '0' && card.price !== 0)
    ? (Number(card.price) / 1e9).toFixed(2) : null;
  const cat = String(card.category || (isWorkflow ? 'workflow' : 'skill')).toUpperCase().slice(0, 8);
  const state = opts.disposed ? 'OFF' : opts.owned ? 'OWNED' : 'GET';
  const nm = card.name || card.id || '';
  const el = document.createElement('button');
  el.className = 'an-sd' + (isWorkflow ? ' is-workflow' : '') + (opts.disposed ? ' is-disposed' : '')
    + (opts.dim ? ' is-owned-dim' : '') + (opts.firing ? ' is-firing' : '');
  el.title = nm; el.setAttribute('data-skill', card.name || '');
  if (card.id) el.setAttribute('data-mint', card.id);
  // sigil is our own deterministic SVG (name only seeds numbers) -> safe to inject as markup;
  // all human-readable fields go through textContent below so a skill name can't inject HTML.
  var imgUrl = (card.image && /^https?:\/\//.test(String(card.image))) ? String(card.image) : null;
  if (imgUrl) el.className += ' has-img';
  // 4c face: the minted card PNG when the item has one; our sigil otherwise. src is set via
  // the property (never string-concatenated) so a hostile url can't break out of the markup.
  el.innerHTML =
    '<span class="an-sd-tab"></span>' +
    '<div class="an-sd-label">' +
      (imgUrl ? '<img class="an-sd-img" alt="" loading="lazy">'
              : '<svg class="an-sd-art" viewBox="0 0 120 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' + skillSigilSvg(nm) + '</svg>' +
                '<span class="an-sd-bar" aria-hidden="true"></span>' +
                '<div class="an-sd-mark"><span class="cat"></span></div>') +
      '<div class="an-sd-name"></div>' +
      '<div class="an-sd-chip"><span class="an-sd-big"></span><span class="an-sd-meta"></span></div>' +
    '</div>';
  if (imgUrl) (el.querySelector('.an-sd-img') as HTMLImageElement).src = imgUrl;
  var catEl = el.querySelector('.an-sd-mark .cat');
  if (catEl) catEl.textContent = cat;
  el.querySelector('.an-sd-name').textContent = nm;
  const big = el.querySelector('.an-sd-big');
  if (card.supply != null) big.textContent = String(card.supply);
  else big.classList.add('bar'); // inventory card: no supply figure, show the 2a dark bar
  const meta = el.querySelector('.an-sd-meta');
  meta.textContent = priceSol ? (priceSol + '\u25ce') : 'FREE';
  meta.appendChild(document.createElement('br'));
  meta.appendChild(document.createTextNode(state));
  // 2a gold star grade: summed GitHub stars of repos using this skill, corner brackets on the
  // right axis under the mark. Only when there are stars (0-star skills stay clean).
  const stars = Number(card.stars) || 0;
  if (stars > 0) {
    const grade = document.createElement('div');
    grade.className = 'an-sd-grade';
    const st = document.createElement('span'); st.className = 'st'; st.textContent = '\u2605';
    grade.appendChild(st);
    grade.appendChild(document.createTextNode(String(stars)));
    el.querySelector('.an-sd-label').appendChild(grade);
  }
  if (opts.onOpen) el.addEventListener('click', () => opts.onOpen(card));
  return el;
}

export function setSkills(names, mints?, meta?) {
  names = names || [];
  // name -> { category, stars, type } from the host's cached catalog; a miss just
  // leaves the generic SKILL mark on the card.
  const sm = meta || {};
  // routing map includes disposed skills too, so clicking a greyed slot still opens its
  // detail (where Re-equip lives) and ownsMint() still treats it as owned (it is, on-chain).
  if (mints) S.skillMints = Object.assign({}, mints, S.disposedMints);
  const grid = document.getElementById('skillGrid');
  const status = document.getElementById('skillStatus');
  const n = names.length;
  const disposedSlugs = Object.keys(S.disposedMints);
  // On-chain is the source of truth: the panel shows only owned NFT skills (those with a
  // mint), never the built-in bundled defaults. This is unconditional now — the old
  // "Hide default" toggle was removed since ownership, not a filter, defines the inventory.
  const shown = names.filter((nm) => !!S.skillMints[nm]);
  // NOTE: do NOT light up "casting" here — owning a skill is not the same as using it.
  // The glow (panel/button/slot) is driven only by flashSkill when a skill actually fires.
  // header count chip (the 2a header shows a number, not a sentence)
  status.textContent = String(shown.length + disposedSlugs.length);
  grid.innerHTML = '';
  for (const name of shown) {
    // Bought NFT skills have a mint -> open the market detail view (on-chain source, and it
    // carries the comment box — the popup modal doesn't). Bundled skills (no mint) fall back
    // to the local SKILL.md doc. Avoids the name!=slug 404 on disk.
    const open = () => { const mt = S.skillMints[name]; if (mt) { showView('market'); openDetail(mt); } else openSkillDoc(name); };
    const info = sm[name] || {};
    grid.appendChild(skillSdCard({ id: S.skillMints[name], name: name, category: info.category, type: info.type, stars: info.stars },
      { owned: true, onOpen: open }));
  }
  // un-pinned skills: shown greyed + desaturated, still listed (not gone). Click opens the
  // detail view, which shows a Re-equip button for an owned-but-disposed skill.
  for (const name of disposedSlugs) {
    const info = sm[name] || {};
    const c = skillSdCard({ id: S.disposedMints[name], name: name, category: info.category, type: info.type, stars: info.stars },
      { owned: true, disposed: true,
      onOpen: () => { showView('market'); openDetail(S.disposedMints[name]); } });
    c.title = name + ' - un-pinned (click to re-equip)';
    grid.appendChild(c);
  }
  const fill = Math.max(0, 3 - shown.length - disposedSlugs.length);
  for (let i = 0; i < fill; i++) { const s = document.createElement('div'); s.className = 'skSlot empty'; grid.appendChild(s); }
  S.ownedSkills = names;
  // mirror the owned count onto the wallet-menu Skills entry (badge hidden when 0)
  const wc = document.getElementById('walletSkillCount');
  if (wc) { wc.textContent = n ? String(n) : ''; wc.style.display = n ? '' : 'none'; }
  // keep the inline wallet list fresh if it's currently expanded
  const wsl = document.getElementById('walletSkillList');
  if (wsl && wsl.style.display !== 'none') renderWalletSkillList();
  // keep the workflow builder's required-skills picker fresh if it's currently open
  if (pubReqWrap && pubReqWrap.style.display !== 'none') renderPubReq();
}

export function wireSkills() {
  skillsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = skillsPanel.style.display !== 'none';
    skillsPanel.style.display = open ? 'none' : 'block';
    skillsBtn.classList.toggle('on', !open);
  });
  if (skillsCloseBtn) skillsCloseBtn.addEventListener('click', (e) => { e.stopPropagation(); closeSkillsPanel(); });
  if (walletSkillsItem && walletSkillList) walletSkillsItem.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = walletSkillList.style.display !== 'none';
    if (open) { walletSkillList.style.display = 'none'; walletSkillsItem.classList.remove('open'); return; }
    renderWalletSkillList();
    walletSkillList.style.display = 'flex';
    walletSkillsItem.classList.add('open');
  });
  setSkills([]); // idle: grey coming-soon slots
  // The panel is inventory-only: searching/buying happens in the full Markets view, reached
  // via the SHOP button. (The old in-panel search box + result grid were removed.)
  vscode.postMessage({ type: 'ownedSkills' }); // hydrate the panel on load
}
