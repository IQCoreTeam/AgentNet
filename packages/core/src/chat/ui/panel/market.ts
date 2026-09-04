// Panel module cut from the legacy webview script (issue #215). Bodies are verbatim apart from
// the S.<name> state rewrite. Top-level statements live in wireMarket() because ESM evaluates
// modules in dependency order, and main.ts calls the wire functions in the legacy order so
// listener registration and boot posts keep their sequence.
import { S } from "./state.js";
import { avatarSvg } from "../avatar.js";
import { LAYERS_SVG, WAND_SVG } from "../icons.js";
import { IQ_LOGO_SVG } from "../iqlogo.js";
import { uiGet, uiSet, vscode } from "./host.js";
import { gitLinkNode } from "./agents.js";
import { showProfile } from "./feed.js";
import { fmtPrice, splitSkillDoc } from "./format.js";
import { renderMd } from "./markdown.js";
import { skSd } from "./skeleton.js";
import { skillSdCard } from "./skills.js";

// ---- passive skill-shopping toggle (issue #21) ----
export const shopToggle = document.getElementById('shopToggle');
export function setShopToggle(on) {
  shopToggle.classList.toggle('on', !!on);
  shopToggle.setAttribute('aria-checked', on ? 'true' : 'false');
}

// ---- Markets full-screen view (same contract, marketplace design) ----
export const mktSearch = document.getElementById('mktSearch') as HTMLInputElement;
export const mktResults = document.getElementById('mktResults');
export const mktListEl = document.getElementById('mktList');
export const mktDetailEl = document.getElementById('mktDetail');
export const mktDetailBody = document.getElementById('mktDetailBody');
export const mktHideOwnedCb = document.getElementById('mktHideOwned') as HTMLInputElement;
export const mktSortBtn = document.getElementById('mktSortBtn');
export function paintSortBtn() {
  if (!mktSortBtn) return;
  mktSortBtn.textContent = S.mktSort === 'stars' ? '\u2605 Stars' : 'Popular';
  mktSortBtn.classList.toggle('stars', S.mktSort === 'stars');
}
export function runMarketSearch() {
  mktResults.innerHTML = skSd(8);
  vscode.postMessage({ type: 'searchSkills', query: mktSearch.value.trim(), kind: S.currentKind, sort: S.mktSort });
}
export function openMarket() {
  showMktList();
  // first open (and re-open) loads the popular list (empty query = supply-sorted)
  mktResults.innerHTML = skSd(8);
  vscode.postMessage({ type: 'searchSkills', query: '', kind: S.currentKind, sort: S.mktSort });
  vscode.postMessage({ type: 'ownedSkills' });
  vscode.postMessage({ type: 'getBalance' }); // show funds in the market header
}
export function showMktList() { mktListEl.style.display = 'block'; mktDetailEl.style.display = 'none'; }
export function showMktDetail() { mktListEl.style.display = 'none'; mktDetailEl.style.display = 'block'; }
export function openDetail(mint) {
  showMktDetail();
  mktDetailBody.innerHTML = '<div class="mktEmpty">Loading…</div>';
  vscode.postMessage({ type: 'getSkillDetail', mint });
}

// ---- skill popup (opened from a profile skill card) ----------------------
// A modal overlay that reuses the .dt-* detail styles. Routed separately from
// the market detail view via skillModalOpen so one getSkillDetail reply lands
// in the right place.
export const skillModalEl = document.getElementById('skillModal');
export const skillModalBody = document.getElementById('skillModalBody');
export function openSkillModal(mint) {
  S.skillModalOpen = true;
  S.skillModalBuyBtn = null; S.skillModalName = null; S.skillModalMint = null;
  skillModalBody.innerHTML = '<div class="mktEmpty">Loading…</div>';
  skillModalEl.style.display = 'flex';
  vscode.postMessage({ type: 'getSkillDetail', mint });
  // The panel may not have received an ownedSkills push yet (the modal opens from the
  // profile, not the market) — request one so refreshModalOwned can flip Buy → Owned
  // instead of offering to re-buy a soulbound skill we already hold.
  vscode.postMessage({ type: 'ownedSkills' });
}
export function closeSkillModal() {
  S.skillModalOpen = false; S.skillDocOpen = false; S.skillModalBuyBtn = null; S.skillModalName = null; S.skillModalMint = null;
  skillModalEl.style.display = 'none';
}
// flip the modal's Buy → Owned once an ownedSkills refresh shows we now hold it
export function refreshModalOwned() {
  if (S.skillModalBuyBtn && (ownsMint(S.skillModalMint) || (S.skillModalName && S.ownedSkills.indexOf(S.skillModalName) >= 0))) {
    S.skillModalBuyBtn.disabled = true; S.skillModalBuyBtn.textContent = 'Owned';
  }
}
export function renderSkillModal(detail) {
  const c = (detail && detail.card) || {};
  // Ownership is decided by MINT first, same as the market detail and the comment
  // gate (ownsMint) — name matching alone breaks for skills whose detail comes back
  // with name === mint, which is what offered Buy on an already-owned skill.
  const owned = ownsMint(c.id) || S.ownedSkills.indexOf(c.name) >= 0;
  S.skillModalName = c.name || null;
  S.skillModalMint = c.id || null;
  skillModalBody.innerHTML = '';
  const head = document.createElement('div'); head.className = 'dt-head';
  const img = document.createElement('div'); img.className = 'dt-img';
  img.innerHTML = '<span class="wand">' + IQ_LOGO_SVG + '</span>';
  const htxt = document.createElement('div');
  const kind = document.createElement('div'); kind.className = 'dt-kind'; kind.textContent = (c.type || 'skill');
  const nm = document.createElement('div'); nm.className = 'dt-name'; nm.textContent = c.name || c.id || '';
  htxt.appendChild(kind); htxt.appendChild(nm);
  head.appendChild(img); head.appendChild(htxt); skillModalBody.appendChild(head);
  if (c.description) { const d = document.createElement('div'); d.className = 'dt-desc'; d.textContent = c.description; skillModalBody.appendChild(d); }
  const meta = document.createElement('div'); meta.className = 'dt-meta';
  const addTag = (t) => { const s = document.createElement('span'); s.className = 'dt-tag'; s.textContent = t; meta.appendChild(s); };
  if (c.category) addTag(c.category);
  for (const h of (c.hashtags || [])) addTag('#' + h);
  if (typeof c.supply === 'number') addTag(c.supply + '\u00d7 owned');
  const price = fmtPrice(c.price); if (price) addTag(price);
  if (meta.childElementCount) skillModalBody.appendChild(meta);
  // buy (hidden on your own skills — you can't buy what you authored)
  if (!owned || c.type) {
    const buy = document.createElement('button'); buy.className = 'dt-buy';
    const buyLabel = price && price !== 'Free' ? ('Buy · ' + price) : 'Buy';
    buy.textContent = owned ? 'Owned' : buyLabel; buy.disabled = owned;
    buy.addEventListener('click', () => {
      buy.disabled = true; buy.textContent = 'Buying…';
      vscode.postMessage({ type: 'buySkill', skillId: c.id, creatorWallet: c.creator });
    });
    skillModalBody.appendChild(buy); S.skillModalBuyBtn = buy;
  }
  if (detail && detail.skillText) {
    const sec = document.createElement('div'); sec.className = 'dt-sec'; sec.textContent = (c.type === 'workflow' ? 'Workflow' : 'Skill') + ' text';
    const bd = document.createElement('div'); bd.className = 'dt-body'; bd.textContent = detail.skillText;
    skillModalBody.appendChild(sec); skillModalBody.appendChild(bd);
  }
}

// ---- equipped-skill doc popup: click an installed skill -> show its local SKILL.md ----
// Equipped skills carry only a name (no mint), so this reads the on-disk SKILL.md by name
// (host getSkillDoc) and renders the body as markdown, reusing the #skillModal overlay.
export function openSkillDoc(name) {
  S.skillModalOpen = false; S.skillDocOpen = true;
  S.skillModalName = null; S.skillModalBuyBtn = null;
  skillModalBody.innerHTML = '<div class="skDoc-empty">Loading…</div>';
  skillModalEl.style.display = 'flex';
  vscode.postMessage({ type: 'getSkillDoc', name: name });
}
export function renderSkillDoc(name, text) {
  skillModalBody.innerHTML = '';
  const nm = document.createElement('div'); nm.className = 'skDoc-name'; nm.textContent = name;
  skillModalBody.appendChild(nm);
  const body = splitSkillDoc(text);
  if (!body) {
    const e = document.createElement('div'); e.className = 'skDoc-empty';
    e.textContent = 'No SKILL.md document found for this skill.';
    skillModalBody.appendChild(e); return;
  }
  const bd = document.createElement('div'); bd.className = 'skDoc-body';
  renderMd(bd, body);
  skillModalBody.appendChild(bd);
}
// Render the detail sub-view from a {card, skillText, requiredCards} payload. For a
// workflow, each requiredCard is a clickable row that opens ITS detail (re-uses the
// same view, so you can drill skill→workflow→skill without leaving the market).
export function renderComments(skillId, skillType, notes, owned) {
  const existing = mktDetailBody.querySelector('.dt-comments');
  if (existing) existing.remove();
  const wrap = document.createElement('div'); wrap.className = 'dt-comments';
  const sec = document.createElement('div'); sec.className = 'dt-sec';
  sec.textContent = 'Comments (' + (notes ? notes.length : 0) + ')';
  wrap.appendChild(sec);
  for (const n of (notes || [])) {
    const el = document.createElement('div'); el.className = 'dt-comment';
    const auth = document.createElement('div'); auth.className = 'cm-author';
    if (n.author) {
      // avatar + truncated wallet, the whole row clickable -> that agent's profile
      const av = document.createElement('span'); av.className = 'cm-avatar'; av.innerHTML = avatarSvg(n.author);
      const addr = document.createElement('span'); addr.className = 'cm-addr';
      addr.textContent = n.author.slice(0, 6) + '…' + n.author.slice(-4);
      auth.appendChild(av); auth.appendChild(addr);
      auth.classList.add('cm-link'); auth.title = 'View ' + n.author + "'s profile";
      auth.addEventListener('click', () => showProfile(n.author));
    } else {
      auth.textContent = '?';
    }
    const body = document.createElement('div');
    renderMd(body, n.text || '');
    el.appendChild(auth); el.appendChild(body);
    if (n.gitLink) {
      const gl = gitLinkNode(n.gitLink, 'cm-git');
      if (gl) el.appendChild(gl);
    }
    wrap.appendChild(el);
  }
  // comment input
  const inputWrap = document.createElement('div'); inputWrap.className = 'dt-note-input';
  if (owned) {
    const fh = document.createElement('div'); fh.className = 'an-formhead'; fh.innerHTML = 'FORM // <b>WRITE A COMMENT</b>';
    inputWrap.appendChild(fh);
    const ta = document.createElement('textarea'); ta.placeholder = 'Write a comment…';
    const errEl = document.createElement('div'); errEl.className = 'dt-note-error'; errEl.style.display = 'none';
    const submit = document.createElement('button'); submit.className = 'dt-note-submit'; submit.textContent = 'Post';
    submit.addEventListener('click', () => {
      const text = ta.value.trim();
      if (!text) return;
      submit.disabled = true; submit.textContent = 'Posting…';
      errEl.style.display = 'none';
      vscode.postMessage({ type: 'postNote', skillId, skillType, text });
      ta.value = '';
      // re-enable on next postNoteResult (handled below)
      (submit as any)._pending = true;
    });
    (submit as any)._reset = () => { submit.disabled = false; submit.textContent = 'Post'; };
    (submit as any)._fail = (msg) => { errEl.textContent = msg; errEl.style.display = 'block'; submit.disabled = false; submit.textContent = 'Post'; };
    inputWrap.appendChild(ta); inputWrap.appendChild(errEl); inputWrap.appendChild(submit);
  } else {
    const gate = document.createElement('div'); gate.className = 'dt-note-gate';
    gate.textContent = 'Buy this skill to leave a comment.';
    inputWrap.appendChild(gate);
  }
  wrap.appendChild(inputWrap);
  mktDetailBody.appendChild(wrap);
}

// the item the detail view is currently showing, so a buy result that arrives while
// it's open can flip its button to "Owned" (the buy can happen right here in detail).
export function refreshDetailOwned() {
  if (mktDetailEl.style.display === 'none' || !S.detailBuyBtn || !S.currentDetailName) return;
  if (S.ownedSkills.indexOf(S.currentDetailName) >= 0) { S.detailBuyBtn.textContent = 'Owned'; S.detailBuyBtn.disabled = true; }
}
export function renderDetail(detail) {
  const c = (detail && detail.card) || {};
  // own-by-mint (server's gate) OR own-by-name (catalog skills, where name is real)
  const owned = ownsMint(c.id) || S.ownedSkills.indexOf(c.name) >= 0;
  S.currentDetail = { id: c.id, type: c.type };
  mktDetailBody.innerHTML = '';
  // head: icon + name + kind
  const isWf = c.type === 'workflow';
  const head = document.createElement('div'); head.className = 'dt-head';
  const img = document.createElement('div'); img.className = isWf ? 'dt-img workflow' : 'dt-img';
  img.innerHTML = '<span class="wand">' + (isWf ? LAYERS_SVG : IQ_LOGO_SVG) + '</span>';
  const htxt = document.createElement('div');
  const kind = document.createElement('div'); kind.className = isWf ? 'dt-kind workflow' : 'dt-kind'; kind.textContent = (c.type || 'skill');
  const nm = document.createElement('div'); nm.className = 'dt-name'; nm.textContent = c.name || c.id || '';
  htxt.appendChild(kind); htxt.appendChild(nm);
  head.appendChild(img); head.appendChild(htxt);
  mktDetailBody.appendChild(head);
  // description
  if (c.description) { const d = document.createElement('div'); d.className = 'dt-desc'; d.textContent = c.description; mktDetailBody.appendChild(d); }
  // meta: category + hashtags + supply
  const meta = document.createElement('div'); meta.className = 'dt-meta';
  const addTag = (t) => { const s = document.createElement('span'); s.className = 'dt-tag'; s.textContent = t; meta.appendChild(s); };
  if (c.category) addTag(c.category);
  for (const h of (c.hashtags || [])) addTag('#' + h);
  if (typeof c.supply === 'number') addTag(c.supply + '\u00d7 owned');
  if (typeof c.stars === 'number' && c.stars > 0) addTag('\u2605 ' + c.stars); // GH #89: summed stars
  const detailPrice = fmtPrice(c.price);
  if (detailPrice) addTag(detailPrice); // "Free" / "0.1 SOL"
  if (meta.childElementCount) mktDetailBody.appendChild(meta);
  // buy / re-equip / remove. A disposed skill (owned on-chain, un-equipped) shows a free
  // Re-equip; an owned skill shows "Owned" + a Remove (dispose); else the priced Buy.
  const buy = document.createElement('button'); buy.className = 'dt-buy';
  if (isDisposed(c.id)) {
    buy.textContent = 'Re-equip';
    buy.title = "You own this. Re-equip it (re-buying would mint another copy)";
    buy.addEventListener('click', () => {
      buy.disabled = true; buy.textContent = 'Re-equipping…';
      vscode.postMessage({ type: 'reEquipSkill', skillId: c.id });
    });
    mktDetailBody.appendChild(buy);
  } else {
    const buyLabel = detailPrice && detailPrice !== 'Free' ? ('Buy · ' + detailPrice) : 'Buy';
    buy.textContent = owned ? 'Owned' : buyLabel; buy.disabled = owned;
    buy.addEventListener('click', () => {
      buy.disabled = true; buy.textContent = 'Buying…';
      vscode.postMessage({ type: 'buySkill', skillId: c.id, creatorWallet: c.creator });
    });
    mktDetailBody.appendChild(buy);
    if (owned) {
      // un-pin: greys it out + stops the agent loading it, but keeps it (re-equip anytime).
      // Non-destructive, so no confirm — it's a reversible toggle, not a delete.
      const rm = document.createElement('button'); rm.className = 'dt-remove'; rm.textContent = 'Unequip';
      rm.title = 'Un-pin this skill: grey it out and stop loading it. You keep the NFT; re-equip anytime.';
      rm.addEventListener('click', () => {
        rm.disabled = true; rm.textContent = 'Unequipping…';
        vscode.postMessage({ type: 'disposeSkill', skillId: c.id });
      });
      mktDetailBody.appendChild(rm);
    }
  }
  S.detailBuyBtn = buy; S.currentDetailName = c.name || null; // remember so buyResult can update it
  // required skills (workflow only) — clickable rows
  const reqs = (detail && detail.requiredCards) || [];
  if (reqs.length) {
    const sec = document.createElement('div'); sec.className = 'dt-sec'; sec.textContent = 'Required skills'; mktDetailBody.appendChild(sec);
    for (const rc of reqs) {
      const row = document.createElement('div'); row.className = 'dt-req';
      const w = document.createElement('span'); w.className = 'wand'; w.style.width = '14px'; w.style.color = 'var(--an-green)'; w.innerHTML = WAND_SVG;
      const rn = document.createElement('span'); rn.className = 'rq-name'; rn.textContent = rc.name || rc.id;
      const ar = document.createElement('span'); ar.className = 'rq-arrow'; ar.textContent = '\u203a';
      row.appendChild(w); row.appendChild(rn); row.appendChild(ar);
      row.addEventListener('click', () => openDetail(rc.id)); // drill into that skill
      mktDetailBody.appendChild(row);
    }
  }
  // repos that use this skill, star-ranked (GH #89). Summed stars = c.stars (same source).
  const repos = (detail && detail.repos) || [];
  if (repos.length) {
    const total = typeof c.stars === 'number' ? c.stars : repos.reduce((s, r) => s + (r.stars || 0), 0);
    const sec = document.createElement('div'); sec.className = 'dt-usedby';
    const lbl = document.createElement('span'); lbl.textContent = 'Used by';
    const stt = document.createElement('span'); stt.className = 'uc-star'; stt.textContent = '\u2605 ' + total;
    sec.appendChild(lbl); sec.appendChild(stt);
    mktDetailBody.appendChild(sec);
    for (const r of repos) {
      const a = document.createElement('a'); a.className = 'dt-repo'; a.href = r.url || '#'; a.target = '_blank'; a.rel = 'noreferrer';
      const nm = document.createElement('span'); nm.className = 'rq-name'; nm.textContent = (r.owner || '') + '/' + (r.name || '');
      const st = document.createElement('span'); st.className = 'dt-repo-stars'; st.textContent = '\u2605 ' + (r.stars || 0);
      a.appendChild(nm); a.appendChild(st);
      mktDetailBody.appendChild(a);
    }
  }
  // body (skillText)
  if (detail && detail.skillText) {
    const sec = document.createElement('div'); sec.className = 'dt-sec'; sec.textContent = (c.type === 'workflow' ? 'Workflow' : 'Skill') + ' text'; mktDetailBody.appendChild(sec);
    const body = document.createElement('div'); body.className = 'dt-body'; body.textContent = detail.skillText; mktDetailBody.appendChild(body);
  }
  // comments section (issue #34) — notes bundled in detail, or empty on first render
  renderComments(c.id, c.type, detail && detail.notes, owned);
}
export function renderMarketResults(results) {
  results = results || [];
  mktResults.innerHTML = '';
  if (!results.length) {
    // empty can mean "no match" OR "no DAS RPC so reads return nothing" — say which.
    mktResults.innerHTML = S.dasReady
      ? '<div class="mktEmpty">No skills found.</div>'
      : '<div class="mktEmpty">No skills found. The default RPC can\'t read the marketplace. Add a Helius key (free devnet tier) in the wallet menu \u2192 RPC.</div>';
    return;
  }
  let shown = 0, hidden = 0;
  for (const r of results) {
    // The whole SD card opens the detail view (where Buy lives) — an already-owned card
    // reads muted (dim). Workflows get the mint cartridge via is-workflow inside skillSdCard.
    const owned = S.ownedSkills.indexOf(r.name) >= 0;
    // "Hide owned" (on by default): you came to find NEW skills, so drop the ones you hold.
    if (S.hideOwnedMarket && owned) { hidden++; continue; }
    mktResults.appendChild(skillSdCard(r, { owned: owned, dim: owned, onOpen: (c) => openDetail(c.id) }));
    shown++;
  }
  // everything matched but all of it is already owned and filtered out — say why the grid is empty.
  if (!shown && hidden) {
    mktResults.innerHTML = '<div class="mktEmpty">You already own all ' + hidden + ' matching skill' + (hidden > 1 ? 's' : '') + '. Uncheck "Hide owned" to see them.</div>';
  }
}

// resolve a skill display name from a buy result's id, using the last search results.
export function nameForId(id) {
  for (const r of S.lastMarketResults) if (r.id === id) return r.name || r.id;
  return null;
}
// Ownership for the comment gate is decided by MINT, not by display name — the
// server gates postNote on heldSkillMints (held-mint membership), so the UI must use the same key.
// skillMints maps owned slug -> mint; a detail whose id is one of those values is
// held. (Name matching breaks for held skills the catalog omits, whose detail comes
// back with name === mint.)
export function ownsMint(id) {
  if (!id) return false;
  for (const k in S.skillMints) if (S.skillMints[k] === id) return true;
  return false;
}
// A skill the wallet owns on-chain but un-pinned (disposed). Still owned (soulbound), so
// the detail offers a free Re-equip instead of a paid re-Buy.
export function isDisposed(id) { return !!id && S.disposedMintSet.has(id); }

export function wireMarket() {
  shopToggle.addEventListener('click', () => {
    const next = !shopToggle.classList.contains('on');
    setShopToggle(next); // optimistic; the host echoes the persisted value back
    vscode.postMessage({ type: 'setSkillShopping', on: next });
  });
  vscode.postMessage({ type: 'getSkillShopping' }); // hydrate the switch on load
  // "Hide owned" market filter: default ON (uiGet is undefined on first run) so the grid
  // surfaces NEW skills, matching mobile. Persisted, so the choice sticks across reloads.
  S.hideOwnedMarket = uiGet('hideOwnedMarket'); if (S.hideOwnedMarket === undefined) S.hideOwnedMarket = true;
  if (mktHideOwnedCb) {
    mktHideOwnedCb.checked = S.hideOwnedMarket;
    mktHideOwnedCb.addEventListener('change', () => {
      S.hideOwnedMarket = mktHideOwnedCb.checked;
      uiSet('hideOwnedMarket', S.hideOwnedMarket);
      renderMarketResults(S.lastMarketResults);
    });
  }
  // Market ranking: 'supply' (popularity, indexer default) or 'stars' (summed GitHub
  // stars of repos that use the skill, GH #89). Persisted like the other market prefs.
  S.mktSort = uiGet('mktSort') === 'stars' ? 'stars' : 'supply';
  paintSortBtn();
  if (mktSortBtn) mktSortBtn.addEventListener('click', () => {
    S.mktSort = S.mktSort === 'stars' ? 'supply' : 'stars';
    uiSet('mktSort', S.mktSort); paintSortBtn(); runMarketSearch();
  });
  document.getElementById('mktSearchBtn').addEventListener('click', runMarketSearch);
  document.getElementById('backToList').addEventListener('click', showMktList);
  mktSearch.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') { e.preventDefault(); runMarketSearch(); }
  });
  // Skills / Workflows tabs — switching re-runs the search filtered to that kind.
  for (const tab of document.querySelectorAll('.mktTab')) {
    tab.addEventListener('click', () => {
      S.currentKind = tab.getAttribute('data-kind');
      for (const t of document.querySelectorAll('.mktTab')) t.classList.toggle('on', t === tab);
      runMarketSearch();
    });
  }
  document.getElementById('skillModalClose').addEventListener('click', closeSkillModal);
  skillModalEl.addEventListener('click', (e) => { if (e.target === skillModalEl) closeSkillModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (S.skillModalOpen || S.skillDocOpen)) closeSkillModal(); });
}
