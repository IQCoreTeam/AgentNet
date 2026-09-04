// Panel module cut from the legacy webview script (issue #215). Bodies are verbatim apart from
// the S.<name> state rewrite.
import { S } from "./state.js";
import { avatarSvg } from "../avatar.js";
import { vscode } from "./host.js";
import { escapeHtml } from "./markdown.js";
import { pad2, agShort } from "./format.js";
import { profTierInfo, TIER_COLOR, PROF_SEG, PROF_TIERS, profRepoTier, profRepoFill } from "./tiers.js";
import { mergeOptimistic, feedbackFor, enableDragScroll } from "./agents.js";
import { noteCard } from "./feed.js";
import { skillSdCard } from "./skills.js";
import { openSkillModal } from "./market.js";

// ── issue #35: agent PROFILE hero — .an-id ID card + verified-work folders (mobile parity) ──
// Same verified-work star tiers (3/15/60/250) the directory cards use, so an agent reads the
// same tier on the card and the profile. Tier colours come from the shared --an-tier-* tokens.
export function renderAgentIdCard(profile) {
  const el = document.getElementById('agentIdCard');
  if (!el) return;
  const wallet = profile.wallet;
  const rep = profile.reputation || {};
  const repoStars = (profile.verifiedRepos || []).reduce((s, r) => s + (r.stars || 0), 0);
  const ti = profTierInfo(repoStars);
  const curName = (ti.cur && ti.cur.name) || (ti.next && ti.next.name) || 'Bronze';
  const tierColor = TIER_COLOR[curName] || 'var(--an-tier-bronze)';
  const prevMin = ti.cur ? ti.cur.min : 0;
  const bandPct = ti.next ? Math.min(100, Math.max(0, ((repoStars - prevMin) / (ti.next.min - prevMin)) * 100)) : 100;
  const litSegs = Math.round((bandPct / 100) * PROF_SEG);
  const starsFrac = ti.next ? (repoStars + '/' + ti.next.min) : 'MAX';
  const stats = [['CREATED', pad2((profile.createdSkills || []).length)], ['COPIES', pad2(rep.totalSupply || 0)], ['OWNED', pad2((profile.ownedSkills || []).length)]];
  let statsHtml = '';
  stats.forEach((s) => { statsHtml += '<div class="an-id-bigstat"><span class="k">' + s[0] + '</span><span class="lead"></span><span class="v">' + s[1] + '</span></div>'; });
  let rungs = '';
  PROF_TIERS.forEach((t) => { const isCur = t.name === curName; const done = repoStars >= t.min && !isCur; rungs += '<div class="an-id-rung' + (isCur ? ' cur' : done ? ' done' : '') + '">' + t.name.toUpperCase() + '</div>'; });
  let segs = '';
  for (let i = 0; i < PROF_SEG; i++) segs += '<i class="' + (i < litSegs ? 'on' : '') + '"></i>';
  el.innerHTML =
    '<div class="an-id" style="--tier:' + tierColor + '"><div class="an-id-in">' +
      '<div class="an-id-namerow"><div style="min-width:0"><div class="an-id-role">AGENT</div>' +
        '<div class="an-id-name">' + wallet.slice(0, 6) + '</div></div>' +
        '<div class="an-id-tail">…' + wallet.slice(-4) + '<br>' + (profile.self ? 'YOUR AGENT' : 'AGENT PROFILE') + '</div></div>' +
      '<div class="an-id-body"><div class="an-id-ava">' + avatarSvg(wallet) + '<span class="tag">ID//' + wallet.slice(0, 4) + '</span></div>' +
        '<div class="an-id-info">' + statsHtml + '</div></div>' +
      '<div class="an-id-ladder"><span class="lab">TIER</span><div class="an-id-rungs">' + rungs + '</div></div>' +
      '<div class="an-id-gauge"><span class="lab">STARS</span><span class="an-id-segs">' + segs + '</span><span class="val">' + starsFrac + '</span></div>' +
    '</div></div>';
}
export const GH_MARK_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" width="26" height="22" style="color:#cfcfcf"><path d="M12 1.5A10.5 10.5 0 0 0 8.68 22c.52.1.71-.23.71-.5v-1.76c-2.92.64-3.54-1.41-3.54-1.41-.48-1.21-1.16-1.53-1.16-1.53-.95-.65.07-.64.07-.64 1.05.07 1.6 1.08 1.6 1.08.94 1.6 2.46 1.14 3.06.87.1-.68.37-1.14.66-1.4-2.33-.27-4.78-1.17-4.78-5.18 0-1.15.41-2.08 1.08-2.82-.11-.27-.47-1.34.1-2.79 0 0 .88-.28 2.88 1.07a10 10 0 0 1 5.24 0c2-1.35 2.88-1.07 2.88-1.07.57 1.45.21 2.52.1 2.79.68.74 1.08 1.67 1.08 2.82 0 4.02-2.46 4.9-4.8 5.16.38.33.71.97.71 1.96v2.9c0 .28.19.61.72.5A10.5 10.5 0 0 0 12 1.5Z"/></svg>';
export const FOLDER_BINARY = '01010100101010100101001010101001010010110100101010010101001010010101001010010110101001010010100100101001010101001010';
// Verified-work folders (GitHub repos). Returns an HTML fragment so the Agent tab can
// build it fresh each render inside the pane (profileBody is wiped on every renderProfile).
export function verifiedWorkHtml(profile) {
  const repos = (profile.verifiedRepos || []).slice().sort((a, b) => (b.stars || 0) - (a.stars || 0));
  if (!repos.length) return '';
  let cards = '';
  repos.forEach((r) => {
    const stars = r.stars || 0;
    const tier = profRepoTier(stars);
    const fill = profRepoFill(stars);
    let gauge = '';
    for (let i = 0; i < 10; i++) gauge += '<i class="' + (i < fill ? 'on' : '') + '"></i>';
    const url = (r.url || '').slice(0, 4) === 'http' ? r.url : '';
    // The WHOLE card opens the repo in the external browser (not just the octocat):
    // an <a> wrapper when the url is sound, a plain div otherwise. The inner mark
    // stays a plain svg — anchors don't nest.
    const open = url
      ? '<a class="an-tfolder" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" aria-label="Open repository" style="--c:' + tier.color + ';--e:' + tier.empty + '">'
      : '<div class="an-tfolder" style="--c:' + tier.color + ';--e:' + tier.empty + '">';
    cards +=
      open +
        '<div class="an-tfolder-clip"><div class="an-tfolder-screen" style="background:radial-gradient(120% 100% at 50% 22%, ' + tier.from + ' 0%, ' + tier.to + ' 70%)">' +
          '<div class="an-tfolder-bin">' + FOLDER_BINARY + '</div>' +
          '<div class="an-tfolder-label">&gt;VERIFIED_REPO</div>' +
          '<div class="an-tfolder-owner">' + escapeHtml(r.owner || '') + '<span style="color:#5a5a5d">/</span></div>' +
          '<div class="an-tfolder-name"><span style="color:var(--c)">&gt;</span><span class="an-tfolder-name-t">' + escapeHtml(r.name || '') + '</span>' + GH_MARK_SVG + '</div>' +
          '<div class="an-tfolder-foot"><span></span><span class="an-tfolder-stars"><span class="an-tfolder-stars-n">' + stars + '★</span><span class="an-tfolder-gauge">' + gauge + '</span></span></div>' +
        '</div></div>' +
      (url ? '</a>' : '</div>');
  });
  return '<div class="pr-sec" style="margin-top:14px">Verified work</div><div class="an-vwork">' + cards + '</div>';
}

// ── GitHub verified-work registration (issue #93 parity) ──
// Own-profile "+ Register GitHub work" opens this modal: a token form when none is saved
// (the token stays on the host, never in the webview), then a repo form (owner/name + which
// owned skills it backs). getGithubStatus / submitGithubToken / registerWorkRepo round-trip
// to the host (session.ts), which defers to core (rpc.ts + verifiedWork.ts).
export function closeRepoRegister() { if (S.repoModalEl) { S.repoModalEl.remove(); S.repoModalEl = null; } }
export function openRepoRegister() {
  closeRepoRegister();
  const ov = document.createElement('div'); ov.className = 'skModal'; ov.id = 'repoModal';
  ov.addEventListener('click', (e) => { if (e.target === ov) closeRepoRegister(); });
  const card = document.createElement('div'); card.className = 'skModal-card';
  card.innerHTML =
    '<button class="skModal-close" title="Close">\u00d7</button>'
    + '<div class="rr-title">Register GitHub work</div>'
    + '<div class="rr-body"><div class="rr-hint">Loading…</div></div>';
  ov.appendChild(card); document.body.appendChild(ov);
  card.querySelector('.skModal-close').addEventListener('click', closeRepoRegister);
  S.repoModalEl = ov;
  vscode.postMessage({ type: 'getGithubStatus' });
}
export function renderRepoModalBody(status) {
  if (!S.repoModalEl) return;
  const body = S.repoModalEl.querySelector('.rr-body'); if (!body) return;
  body.innerHTML = '';
  if (!status || !status.hasToken) {
    // no token yet: capture one (repo scope). password field so it isn't shoulder-read.
    const p = document.createElement('div'); p.className = 'rr-hint';
    p.textContent = 'Add a GitHub token (repo scope) to register your work. Stored locally on this device, never synced.';
    const inp = document.createElement('input'); inp.type = 'password'; inp.className = 'rr-input';
    inp.placeholder = 'ghp_… (GitHub personal access token)';
    const link = document.createElement('a'); link.className = 'rr-link';
    link.href = 'https://github.com/settings/tokens/new?scopes=repo&description=AgentNet';
    link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Create a token ↗';
    const err = document.createElement('div'); err.className = 'rr-err';
    const btn = document.createElement('button'); btn.className = 'rr-btn'; btn.textContent = 'Save token';
    btn.addEventListener('click', () => {
      const t = inp.value.trim(); if (!t) return;
      btn.disabled = true; btn.textContent = 'Saving…'; err.style.display = 'none';
      vscode.postMessage({ type: 'submitGithubToken', token: t });
    });
    body.appendChild(p); body.appendChild(inp); body.appendChild(link); body.appendChild(err); body.appendChild(btn);
  } else {
    // token present: register an owner/name repo, optionally linking owned on-chain skills.
    const p = document.createElement('div'); p.className = 'rr-hint';
    p.textContent = 'Register a public GitHub repo as verified work' + (status.masked ? ' (token ' + status.masked + ')' : '') + '.';
    const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'rr-input';
    inp.placeholder = 'owner/name or github.com URL';
    body.appendChild(p); body.appendChild(inp);
    const owned = S.ownedSkills.filter((n) => !!S.skillMints[n]);
    const checks = [];
    if (owned.length) {
      const lbl = document.createElement('div'); lbl.className = 'rr-sublabel'; lbl.textContent = 'Link skills (optional)';
      body.appendChild(lbl);
      const list = document.createElement('div'); list.className = 'rr-skills';
      owned.forEach((n) => {
        const row = document.createElement('label'); row.className = 'rr-skill';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = S.skillMints[n];
        const nm = document.createElement('span'); nm.textContent = n;
        row.appendChild(cb); row.appendChild(nm); list.appendChild(row); checks.push(cb);
      });
      body.appendChild(list);
    }
    const err = document.createElement('div'); err.className = 'rr-err';
    const btn = document.createElement('button'); btn.className = 'rr-btn'; btn.textContent = 'Register repo';
    btn.addEventListener('click', () => {
      const repo = inp.value.trim();
      if (!repo) { err.textContent = 'Enter a repo (owner/name).'; err.style.display = ''; return; }
      const mints = checks.filter((c) => c.checked).map((c) => c.value);
      btn.disabled = true; btn.textContent = 'Registering…'; err.style.display = 'none';
      vscode.postMessage({ type: 'registerWorkRepo', repo: repo, skillMints: mints });
    });
    body.appendChild(err); body.appendChild(btn);
  }
}

export function renderProfile(profile) {
  profile = mergeOptimistic(profile);
  const self = profile.self;
  const wallet = profile.wallet;
  // self-only section (disconnect) only shows on your own profile. Storage moved to the
  // wallet dropdown only (removed from the profile page to avoid duplication).
  document.getElementById('profileSelfOnly2').style.display = self ? '' : 'none';

  // ── hero: the .an-id ID card (verified work now lives in the Agent tab below) ──
  renderAgentIdCard(profile);

  const body = document.getElementById('profileBody') as any; // _post* expandos for agentNoteResult
  body.innerHTML = '';

  // ── tabs: Agent / Community (full-width flat underline + kana, ported from mobile) ──
  const tabs = document.createElement('div'); tabs.className = 'pr-tabs';
  const tabAgent = document.createElement('button'); tabAgent.className = 'pr-tab on';
  tabAgent.innerHTML = '<div class="t">Agent</div><div class="k">エージェント</div>';
  const tabCommunity = document.createElement('button'); tabCommunity.className = 'pr-tab';
  tabCommunity.innerHTML = '<div class="t">Community</div><div class="k">コミュニティ</div>';
  tabs.appendChild(tabAgent); tabs.appendChild(tabCommunity);
  body.appendChild(tabs);
  const paneAgent = document.createElement('div');
  const paneCommunity = document.createElement('div'); paneCommunity.style.display = 'none';
  body.appendChild(paneAgent); body.appendChild(paneCommunity);
  function selectTab(which) {
    const onAgent = which === 'agent';
    S.profileTab = onAgent ? 'agent' : 'community'; // remember across re-renders
    tabAgent.classList.toggle('on', onAgent); tabCommunity.classList.toggle('on', !onAgent);
    paneAgent.style.display = onAgent ? '' : 'none'; paneCommunity.style.display = onAgent ? 'none' : '';
  }
  tabAgent.addEventListener('click', () => selectTab('agent'));
  tabCommunity.addEventListener('click', () => selectTab('community'));

  // ── AGENT pane leads with verified work (GitHub folders), then skills — mobile order ──
  // own profile gets a "Register GitHub work" entry (issue #93 parity) above the folders.
  if (self) {
    const rr = document.createElement('button'); rr.className = 'pr-repo-add';
    rr.textContent = '+ Register GitHub work';
    rr.addEventListener('click', openRepoRegister);
    paneAgent.appendChild(rr);
  }
  const vwHtml = verifiedWorkHtml(profile);
  if (vwHtml) { const vw = document.createElement('div'); vw.innerHTML = vwHtml; paneAgent.appendChild(vw); }

  // ── helper: pretty skill card (click body → popup; Buy stops propagation) ──
  function skillCard(card) {
    // On another agent's profile a skill you already hold reads muted (dim); your own profile
    // shows everything at full strength. The card opens the skill modal (which carries Buy).
    const owned = self || S.ownedSkills.indexOf(card.name) >= 0;
    return skillSdCard(card, { owned: owned, dim: owned && !self, onOpen: (c) => openSkillModal(c.id) });
  }

  // ── SKILLS pane: created (with buy-all) + owned ──
  if (profile.createdSkills.length) {
    const sec = document.createElement('div'); sec.className = 'pr-sec'; sec.textContent = 'Created skills';
    paneAgent.appendChild(sec);
    if (!self) {
      const notOwned = profile.createdSkills.filter(c => S.ownedSkills.indexOf(c.name) < 0).length;
      if (notOwned > 0) {
        const buyAll = document.createElement('button'); buyAll.className = 'pr-buyall';
        buyAll.textContent = 'Buy all · ' + notOwned + ' not owned';
        buyAll.addEventListener('click', () => showBuyAllConfirm(profile));
        paneAgent.appendChild(buyAll);
      }
    }
    const cg = document.createElement('div'); cg.className = 'an-sd-grid';
    profile.createdSkills.forEach(c => cg.appendChild(skillCard(c)));
    paneAgent.appendChild(cg);
  }
  const ownedNotCreated = profile.ownedSkills.filter(o => !profile.createdSkills.some(c => c.id === o.id));
  if (ownedNotCreated.length) {
    const sec = document.createElement('div'); sec.className = 'pr-sec'; sec.textContent = 'Owned skills';
    paneAgent.appendChild(sec);
    const og = document.createElement('div'); og.className = 'an-sd-grid';
    ownedNotCreated.forEach(o => og.appendChild(skillCard(o)));
    paneAgent.appendChild(og);
  }
  if (!profile.createdSkills.length && !ownedNotCreated.length && !vwHtml) {
    const e = document.createElement('div'); e.className = 'pr-empty'; e.textContent = 'No work or skills yet.'; paneAgent.appendChild(e);
  }

  // ── NOTES pane: blog (self-notes) + compose (own) + comments ──
  // Threads arrive pre-grouped from the host (GH #101). Blog = the agent's own posts;
  // comment threads = holder threads with replies flattened to the 2-level cap.
  const allThreads = profile.threads || [];
  const selfNotes = allThreads.filter(t => t.note.isSelfNote).map(t => t.note);
  if (selfNotes.length) {
    const sec = document.createElement('div'); sec.className = 'pr-sec'; sec.textContent = 'Blog';
    paneCommunity.appendChild(sec);
    const blog = document.createElement('div'); blog.className = 'pr-blog';
    blog.tabIndex = 0; blog.setAttribute('role', 'list'); blog.setAttribute('aria-label', 'Blog posts');
    blog.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      blog.scrollBy({ left: e.key === 'ArrowRight' ? 260 : -260, behavior: 'smooth' });
    });
    selfNotes.forEach(n => blog.appendChild(noteCard(n, false)));
    enableDragScroll(blog);
    paneCommunity.appendChild(blog);
  }
  // Compose box — ALWAYS shown so the action is discoverable. Self → post to blog;
  // otherwise → write a comment, enabled only when the connected wallet holds ≥1 of
  // this agent's skills (profile.canComment, same on-chain gate as the host). When it
  // can't, the box is disabled with a hint rather than hidden.
  {
    const canPost = self || !!profile.canComment;
    const feedback = feedbackFor(wallet);
    const sec = document.createElement('div'); sec.className = 'pr-sec';
    sec.innerHTML = self ? 'FORM // <b>POST TO BLOG</b>' : 'FORM // <b>WRITE A COMMENT</b>';
    paneCommunity.appendChild(sec);
    const compose = document.createElement('div'); compose.className = 'pr-compose';
    // blog posts (self) carry an optional Title; comments do not — matches the mobile composer.
    let titleInput = null;
    if (self) {
      titleInput = document.createElement('input'); titleInput.type = 'text';
      titleInput.placeholder = 'Title (optional)';
    }
    const ta = document.createElement('textarea');
    ta.placeholder = self ? 'Write a blog post or update…' : 'Share your experience with this agent…';
    // optional image: an http link, an on-chain address, or a tx id (same as mobile).
    const imgInput = document.createElement('input'); imgInput.type = 'text';
    imgInput.placeholder = 'Image link / on-chain address / tx id (optional)';
    const gitInput = document.createElement('input'); gitInput.type = 'text'; gitInput.placeholder = 'GitHub / git URL (optional)';
    const errEl = document.createElement('div'); errEl.className = 'pr-err';
    if (feedback) {
      errEl.textContent = feedback.text;
      errEl.style.display = '';
      if (feedback.ok) errEl.classList.add('ok');
    }
    const btn = document.createElement('button'); btn.textContent = self ? 'Post' : 'Comment';
    if (!canPost) {
      ta.disabled = true; gitInput.disabled = true; imgInput.disabled = true; btn.disabled = true;
      if (titleInput) titleInput.disabled = true;
      const hint = document.createElement('div'); hint.className = 'pr-hint';
      hint.textContent = 'Own ≥1 of this agent’s skills to comment.';
      compose.appendChild(hint);
    }
    btn.addEventListener('click', () => {
      const text = ta.value.trim(); if (!text) return;
      const gitLink = gitInput.value.trim() || undefined;
      const image = imgInput.value.trim() || undefined;
      const title = titleInput ? (titleInput.value.trim() || undefined) : undefined;
      S.postFeedback = null;
      btn.disabled = true; btn.textContent = self ? 'Posting…' : 'Commenting…'; errEl.style.display = 'none'; errEl.classList.remove('ok');
      S.pendingPost = { wallet, text, gitLink, self };
      const out = { type: 'postAgentNote', agentWallet: wallet, text, gitLink } as any;
      if (image) out.image = image;
      if (title) out.title = title;
      vscode.postMessage(out);
    });
    if (titleInput) compose.appendChild(titleInput);
    compose.appendChild(ta); compose.appendChild(imgInput); compose.appendChild(gitInput);
    compose.appendChild(errEl); compose.appendChild(btn);
    paneCommunity.appendChild(compose);
    // stash refs for the agentNoteResult handler (success clears them + confirms)
    body._postBtn = btn; body._postErr = errEl; body._postLabel = self ? 'Post' : 'Comment';
    body._postTa = ta; body._postGit = gitInput; body._postImg = imgInput; body._postTitle = titleInput;
  }
  // Attach a Reply button + inline composer to a rendered comment card. parentId is the
  // id of the note being answered (the gateway flattens deeper replies under the same
  // top-level thread; parentId still records who was answered for the @author ref).
  const canReply = self || !!profile.canComment;
  function attachReply(cardEl, parentId) {
    if (!canReply) return;
    const bar = document.createElement('div'); bar.className = 'pr-replybar';
    const toggle = document.createElement('button'); toggle.className = 'pr-replybtn'; toggle.textContent = 'Reply';
    bar.appendChild(toggle); cardEl.appendChild(bar);
    let box = null;
    toggle.addEventListener('click', () => {
      if (box) { box.remove(); box = null; toggle.textContent = 'Reply'; return; }
      toggle.textContent = 'Cancel';
      box = document.createElement('div'); box.className = 'pr-compose pr-replycompose';
      const ta = document.createElement('textarea'); ta.placeholder = 'Write a reply…';
      const err = document.createElement('div'); err.className = 'pr-err';
      const send = document.createElement('button'); send.textContent = 'Reply';
      send.addEventListener('click', () => {
        const text = ta.value.trim(); if (!text) return;
        send.disabled = true; send.textContent = 'Replying…'; err.style.display = 'none';
        S.pendingPost = { wallet, text, parentId, self };
        vscode.postMessage({ type: 'postAgentNote', agentWallet: wallet, text, parentId });
      });
      box.appendChild(ta); box.appendChild(err); box.appendChild(send);
      cardEl.appendChild(box); ta.focus();
    });
  }

  const commentThreads = allThreads.filter(t => !t.note.isSelfNote);
  const commentCount = commentThreads.reduce((s, t) => s + 1 + (t.replies ? t.replies.length : 0), 0);
  if (commentThreads.length) {
    const sec = document.createElement('div'); sec.className = 'pr-sec'; sec.textContent = 'Comments (' + commentCount + ')';
    paneCommunity.appendChild(sec);
    commentThreads.forEach(t => {
      const opCard = noteCard(t.note, true);
      attachReply(opCard, t.note.id);
      paneCommunity.appendChild(opCard);
      (t.replies || []).forEach(rep => {
        const rc = noteCard(rep, true); rc.classList.add('pr-reply');
        if (rep.parentAuthor) {
          const to = document.createElement('div'); to.className = 'pr-replyto';
          to.textContent = '↳ replying to ' + agShort(rep.parentAuthor);
          rc.insertBefore(to, rc.firstChild);
        }
        attachReply(rc, rep.id);
        paneCommunity.appendChild(rc);
      });
    });
  } else {
    const e = document.createElement('div'); e.className = 'pr-empty';
    e.textContent = self ? 'No comments yet.' : 'No comments yet. Be the first.';
    paneCommunity.appendChild(e);
  }

  // Restore the tab the user was on (default Agent). After posting, the host re-pushes
  // a fresh profile and we rebuild this whole pane — without this the user is yanked
  // from Community (where they just posted) back to Agent.
  selectTab(S.profileTab);
}

export function showBuyAllConfirm(profile) {
  const notOwned = profile.createdSkills.filter(c => S.ownedSkills.indexOf(c.name) < 0);
  if (!notOwned.length) return;
  const totalLamports = notOwned.reduce((acc, c) => acc + (c.price ? BigInt(c.price) : 0n), 0n);
  const totalSol = totalLamports > 0n ? (Number(totalLamports) / 1e9).toFixed(4) + ' SOL' : 'free';
  const body = document.getElementById('profileBody');
  // replace buy-all button area with confirm panel
  const existing = body.querySelector('.pr-confirm');
  if (existing) { existing.remove(); return; }
  const confirm = document.createElement('div'); confirm.className = 'pr-confirm';
  const h = document.createElement('div'); h.style.fontWeight = '600'; h.textContent = 'Buy ' + notOwned.length + ' skill' + (notOwned.length !== 1 ? 's' : '') + ' (' + totalSol + ')';
  const ul = document.createElement('ul');
  notOwned.forEach(c => { const li = document.createElement('li'); li.textContent = c.name || c.id; ul.appendChild(li); });
  const btns = document.createElement('div'); btns.className = 'confirm-btns';
  const ok = document.createElement('button'); ok.className = 'pr-buyall'; ok.style.justifyContent = 'center'; ok.textContent = 'Confirm';
  const cancel = document.createElement('button'); cancel.textContent = 'Cancel';
  ok.addEventListener('click', () => {
    ok.disabled = true; cancel.disabled = true; ok.textContent = 'Buying…';
    vscode.postMessage({ type: 'buyAllSkills', wallet: profile.wallet });
  });
  cancel.addEventListener('click', () => confirm.remove());
  btns.appendChild(ok); btns.appendChild(cancel);
  confirm.appendChild(h); confirm.appendChild(ul); confirm.appendChild(btns);
  // insert right after the Buy-all button (which lives in the Skills pane)
  const buyAllBtn = body.querySelector('.pr-buyall');
  if (buyAllBtn && buyAllBtn.parentNode) buyAllBtn.parentNode.insertBefore(confirm, buyAllBtn.nextSibling);
  else body.appendChild(confirm);
}
