// Panel module cut from the legacy webview script (issue #215). Bodies are verbatim apart from
// the S.<name> state rewrite. Top-level statements live in wireFeed() because ESM evaluates
// modules in dependency order, and main.ts calls the wire functions in the legacy order so
// listener registration and boot posts keep their sequence.
import { S } from "./state.js";
import { avatarSvg } from "../avatar.js";
import { vscode } from "./host.js";
import { renderMd } from "./markdown.js";
import { fmtNoteDate, explorerTxUrl, fdAgo, feedImgUrl, agShort } from "./format.js";
import { skId, skSd, skAc, skFd } from "./skeleton.js";
import { panels, showView } from "./views.js";
import { gitLinkNode } from "./agents.js";
import { appendQuoteText } from "./quotes.js";
import type { Note, ThreadNode, ThreadedReply } from "../../../core/types.js";

// ── helper: a note/comment card (date + on-chain tx link in the footer) ──
// __txSignature / __blockTime are attached per-row by the gateway and flow through
// hydrateNotes' spread, so historical cards link to their exact write tx. A freshly
// posted (optimistic) card has only a timestamp until the on-chain read catches up.
// Module scope (issue #210): shared by the profile Community pane and the FEED reader.
export function noteCard(n, withAuthor) {
  const el = document.createElement('div'); el.className = 'pr-note';
  if (withAuthor) {
    const auth = document.createElement('div'); auth.className = 'pr-note-author';
    auth.textContent = n.author ? (n.author.slice(0, 6) + '…' + n.author.slice(-4)) : '?';
    el.appendChild(auth);
  }
  const bodyEl = document.createElement('div'); bodyEl.className = 'pr-note-body'; renderMd(bodyEl, n.text || ''); el.appendChild(bodyEl);
  if (n.gitLink) {
    const gl = gitLinkNode(n.gitLink, 'pr-note-git');
    if (gl) el.appendChild(gl);
  }
  const date = fmtNoteDate(n);
  const sig = typeof n.__txSignature === 'string' ? n.__txSignature : null;
  if (date || sig) {
    const foot = document.createElement('div'); foot.className = 'pr-note-foot';
    const d = document.createElement('span'); d.className = 'pr-note-date'; d.textContent = date;
    foot.appendChild(d);
    if (sig) {
      const a = document.createElement('a'); a.className = 'pr-note-tx';
      a.href = explorerTxUrl(sig); a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = 'tx ↗'; a.title = sig;
      foot.appendChild(a);
    }
    el.appendChild(foot);
  }
  return el;
}

// ---- AGENTNET: FEED (default) | RANK sub tabs (issue #210) ----
// FEED reads the global feed:blog anchor through the same messages the mobile
// surfaces use (getBlogFeed / getBlogPost / getBlogComments / postBlogComment).
// RANK is the pre-existing agent directory, unchanged.
export const feedBodies: Record<string, Note | undefined> = {}; // postId -> authoritative body from the author's table
export const feedThreads: Record<string, ThreadNode[] | undefined> = {}; // postId -> comment threads
export function openAgents() {
  if (S.agentsTab === 'feed') openFeed(); else openRank();
}
export function openRank() {
  document.getElementById('agentsList').innerHTML = skAc(4);
  vscode.postMessage({ type: 'listAgents' });
}
export function selectAgentsTab(name) {
  S.agentsTab = name;
  document.getElementById('agTabFeed').classList.toggle('on', name === 'feed');
  document.getElementById('agTabRank').classList.toggle('on', name === 'rank');
  document.getElementById('agFeedPane').style.display = name === 'feed' ? '' : 'none';
  document.getElementById('agFeedPost').style.display = 'none';
  document.getElementById('agRankPane').style.display = name === 'rank' ? '' : 'none';
  updateFdFab();
  openAgents();
}
export function openFeed() {
  S.currentFeedPost = null;
  document.getElementById('agFeedPost').style.display = 'none';
  document.getElementById('agFeedPane').style.display = '';
  updateFdFab();
  if (S.feedPosts === null) document.getElementById('feedList').innerHTML = skFd(4);
  vscode.postMessage({ type: 'getBlogFeed', sort: S.feedSort });
}
export function setFeedSort(s) {
  if (S.feedSort === s) return;
  S.feedSort = s;
  document.getElementById('fdSortActive').classList.toggle('on', s === 'active');
  document.getElementById('fdSortLatest').classList.toggle('on', s === 'latest');
  S.feedPosts = null; // force skeletons: the two sorts are different reads
  openFeed();
}
export function renderFeed(posts: Note[] | null | undefined) {
  S.feedPosts = posts || [];
  const list = document.getElementById('feedList');
  list.innerHTML = '';
  if (!S.feedPosts.length) {
    const e = document.createElement('div'); e.className = 'pr-empty';
    e.textContent = 'No posts yet. Blog posts land here the moment an agent writes one.';
    list.appendChild(e);
    return;
  }
  S.feedPosts.forEach((p) => {
    // Bumped = a later reply refloated the post. Ticks + the bordered chip show
    // only under ACTIVE, matching the mobile rows.
    const bumped = (p.feedLastActivity || 0) > (p.timestamp || 0);
    const showBump = S.feedSort === 'active' && bumped;
    const row = document.createElement('button'); row.type = 'button';
    row.className = 'fd-row' + (showBump ? ' bumped' : '');
    const top = document.createElement('div'); top.className = 'fd-top';
    const av = document.createElement('span'); av.className = 'fd-ava'; av.innerHTML = avatarSvg(p.author || '');
    const w = document.createElement('span'); w.className = 'fd-wallet'; w.textContent = p.author ? agShort(p.author) : '?';
    top.appendChild(av); top.appendChild(w);
    const when = document.createElement('span');
    if (showBump) { when.className = 'fd-when chip'; when.textContent = 'bumped ' + fdAgo(p.feedLastActivity); }
    else { when.className = 'fd-when'; when.textContent = fdAgo(p.timestamp) ? fdAgo(p.timestamp) + ' ago' : ''; }
    top.appendChild(when);
    row.appendChild(top);
    if (p.title) { const t = document.createElement('p'); t.className = 'fd-title'; t.textContent = p.title; row.appendChild(t); }
    if (p.text) { const sn = document.createElement('p'); sn.className = 'fd-snip'; sn.textContent = p.text; row.appendChild(sn); }
    const img = feedImgUrl(p.image);
    if (img) {
      const c = document.createElement('div'); c.className = 'fd-cover';
      const im = document.createElement('img'); im.src = img; im.referrerPolicy = 'no-referrer'; im.alt = '';
      c.appendChild(im); row.appendChild(c);
    }
    if (p.gitLink) { const gl = gitLinkNode(p.gitLink, 'pr-note-git'); if (gl) row.appendChild(gl); }
    const foot = document.createElement('div'); foot.className = 'fd-foot';
    const replies = p.feedReplies || 0;
    const rep = document.createElement('span'); rep.textContent = '>' + replies + ' ' + (replies === 1 ? 'reply' : 'replies');
    foot.appendChild(rep);
    const date = fmtNoteDate(p);
    if (date) { const d = document.createElement('span'); d.textContent = 'posted ' + date; foot.appendChild(d); }
    const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = '//BLOG';
    foot.appendChild(tag);
    row.appendChild(foot);
    row.addEventListener('click', () => openFeedPost(p));
    list.appendChild(row);
  });
}

// ── FEED post reader: mirrored row renders instantly; the authoritative body is
// re-fetched once from the author's own table (trust: the anchor is permissionless),
// and the comment thread lazy-loads — same semantics as the mobile BlogPostView.
export function openFeedPost(p: Note) {
  S.currentFeedPost = p;
  S.feedReplyTo = null;
  document.getElementById('agFeedPane').style.display = 'none';
  document.getElementById('agFeedPost').style.display = '';
  updateFdFab();
  renderFeedPost();
  if (feedBodies[p.id] === undefined) vscode.postMessage({ type: 'getBlogPost', author: p.author, postId: p.id });
  vscode.postMessage({ type: 'getBlogComments', postId: p.id, agentWallet: p.author });
}
// The mobile NoteComposer, panel-side: textarea + git input + a right-aligned
// [sage] text toggle (amber when on) + the green bracket button.
export function fdComposer(placeholder, submitLabel, submit, withSage) {
  const box = document.createElement('div'); box.className = 'fdp-compose';
  const ta = document.createElement('textarea'); ta.className = 'an-field'; ta.rows = 4; ta.placeholder = placeholder;
  const git = document.createElement('input'); git.className = 'an-field'; git.type = 'text'; git.placeholder = 'GitHub link (optional)';
  const err = document.createElement('div'); err.className = 'pr-err';
  const foot = document.createElement('div'); foot.className = 'fdp-compose-foot';
  let sageOn = false;
  if (withSage) {
    // sage, the imageboard idiom (issue #208): reply without bumping the feed.
    const sage = document.createElement('button'); sage.type = 'button'; sage.className = 'fd-sage'; sage.textContent = '[sage]';
    sage.addEventListener('click', () => {
      sageOn = !sageOn;
      sage.classList.toggle('on', sageOn);
      sage.textContent = sageOn ? '[sage: on]' : '[sage]';
    });
    foot.appendChild(sage);
  }
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'an-btn an-btn-green'; btn.textContent = submitLabel;
  btn.addEventListener('click', () => {
    const text = ta.value.trim(); if (!text) return;
    (document.getElementById('agFeedPost') as any)._activeCompose = box;
    btn.disabled = true; btn.textContent = 'Posting…'; err.style.display = 'none';
    submit({ text, gitLink: git.value.trim() || undefined, sage: sageOn });
  });
  foot.appendChild(btn);
  box.appendChild(ta); box.appendChild(git); box.appendChild(err); box.appendChild(foot);
  (box as any)._btn = btn; (box as any)._err = err; (box as any)._label = submitLabel; (box as any)._ta = ta; (box as any)._git = git;
  return box;
}
export function renderFeedPost() {
  const p = S.currentFeedPost; if (!p) return;
  const pane = document.getElementById('agFeedPost') as any; // _mainCompose/_activeCompose expandos
  // preserve the main composer's half-typed input across thread refreshes
  const keep = pane._mainCompose ? { text: pane._mainCompose._ta.value, git: pane._mainCompose._git.value } : null;
  pane.innerHTML = '';
  pane._activeCompose = null;
  // fresh quote-card registry for this render pass (the old elements were wiped)
  S.quoteCards = {}; S.quoteSeen = {}; S.quoteSlots = 0;
  // >POST … BY xxxx cap row + the [<] POST [date] header bar (mobile chrome)
  const cap = document.createElement('div'); cap.className = 'fdp-cap';
  const capL = document.createElement('span'); capL.innerHTML = '<span style="opacity:.55">&gt;</span>POST';
  const capR = document.createElement('span'); capR.textContent = 'BY ' + (p.author ? agShort(p.author) : '?');
  cap.appendChild(capL); cap.appendChild(capR);
  pane.appendChild(cap);
  const bar = document.createElement('div'); bar.className = 'fdp-bar';
  const bk = document.createElement('button'); bk.type = 'button'; bk.className = 'bk'; bk.textContent = '[<]'; bk.title = 'Back';
  bk.addEventListener('click', () => openFeed());
  const tt = document.createElement('span'); tt.className = 'tt'; tt.textContent = 'Post';
  bar.appendChild(bk); bar.appendChild(tt);
  const date = fmtNoteDate(p);
  if (date) { const dt = document.createElement('span'); dt.className = 'dt'; dt.textContent = '[' + date + ']'; bar.appendChild(dt); }
  pane.appendChild(bar);
  const body = feedBodies[p.id] || p; // authoritative body once it lands, mirror row until then
  const hero = feedImgUrl(body.image || p.image);
  if (hero) {
    const h = document.createElement('div'); h.className = 'fdp-hero';
    const im = document.createElement('img'); im.src = hero; im.referrerPolicy = 'no-referrer'; im.alt = '';
    h.appendChild(im); pane.appendChild(h);
  }
  const title = body.title || p.title;
  if (title) { const t = document.createElement('h1'); t.className = 'fdp-title'; t.textContent = title; pane.appendChild(t); }
  const au = document.createElement('div'); au.className = 'fdp-author';
  const lb = document.createElement('span'); lb.className = 'lb'; lb.textContent = '//AUTHOR_';
  const who = document.createElement('span'); who.className = 'who';
  who.textContent = (p.author ? agShort(p.author) : '?') + (date ? ' [' + date + ']' : '');
  au.appendChild(lb); au.appendChild(who);
  pane.appendChild(au);
  if (body.text) appendQuoteText(pane, body.text, 'fdp-body');
  if (body.gitLink) { const gl = gitLinkNode(body.gitLink, 'pr-note-git'); if (gl) pane.appendChild(gl); }
  // >COMMENTS — OPEN to any connected wallet (issue #183), same as mobile.
  const sec = document.createElement('div'); sec.className = 'fdp-cmts';
  const threads = feedThreads[p.id];
  const capC = document.createElement('p'); capC.className = 'fdp-cmts-cap';
  capC.innerHTML = '<span class="gt">&gt;</span>COMMENTS' + (threads && threads.length ? ' <span class="n">(' + threads.length + ')</span>' : '');
  sec.appendChild(capC);
  const canReply = !!S.myWalletAddress;
  function commentCard(nn: ThreadedReply, topAuthor: Note['author']) {
    const el = document.createElement('div'); el.className = 'fdc';
    const top = document.createElement('div'); top.className = 'fdc-top';
    const av = document.createElement('span'); av.className = 'fdc-ava'; av.innerHTML = avatarSvg(nn.author || '');
    const wl = document.createElement('span'); wl.className = 'fdc-wallet'; wl.textContent = nn.author ? agShort(nn.author) : '?';
    top.appendChild(av); top.appendChild(wl);
    const nd = fmtNoteDate(nn);
    if (nd) { const d = document.createElement('span'); d.className = 'fdc-date'; d.textContent = '[' + nd + ']'; top.appendChild(d); }
    el.appendChild(top);
    if (nn.parentAuthor && nn.parentAuthor !== topAuthor) {
      const to = document.createElement('p'); to.className = 'fdc-to'; to.textContent = '↳ replying to ' + agShort(nn.parentAuthor);
      el.appendChild(to);
    }
    if (nn.text) appendQuoteText(el, nn.text, 'fdc-text');
    if (nn.gitLink) { const gl = gitLinkNode(nn.gitLink, 'pr-note-git'); if (gl) el.appendChild(gl); }
    if (canReply) {
      const rb = document.createElement('button'); rb.type = 'button'; rb.className = 'fdc-replybtn';
      rb.textContent = S.feedReplyTo === nn.id ? '[Cancel]' : '[Reply]';
      rb.addEventListener('click', () => { S.feedReplyTo = S.feedReplyTo === nn.id ? null : nn.id; renderFeedPost(); });
      el.appendChild(rb);
    }
    return el;
  }
  function submitComment(f, parentId) {
    S.feedLastSage = !!f.sage;
    vscode.postMessage({
      type: 'postBlogComment', postId: p.id, agentWallet: p.author, text: f.text,
      gitLink: f.gitLink, parentId: parentId, sage: !!f.sage, feedBump: !f.sage,
    });
  }
  if (threads === undefined) {
    const l = document.createElement('div'); l.className = 'pr-empty'; l.textContent = 'Loading comments…'; sec.appendChild(l);
  } else if (!threads.length) {
    const e = document.createElement('div'); e.className = 'pr-empty'; e.textContent = 'No comments yet. Be the first.'; sec.appendChild(e);
  } else {
    threads.forEach((t) => {
      const wrap = document.createElement('div');
      wrap.appendChild(commentCard(t.note, t.note.author));
      const reps = t.replies || [];
      if (reps.length) {
        const rl = document.createElement('div'); rl.className = 'fdc-replies';
        reps.forEach((r) => rl.appendChild(commentCard(r, t.note.author)));
        wrap.appendChild(rl);
      }
      const replyingHere = S.feedReplyTo === t.note.id || reps.some((r) => r.id === S.feedReplyTo);
      if (replyingHere && canReply) {
        const rc = fdComposer('Write a reply...', 'Reply', (f) => submitComment(f, S.feedReplyTo || t.note.id), true);
        rc.style.marginLeft = '16px';
        wrap.appendChild(rc);
      }
      sec.appendChild(wrap);
    });
  }
  if (canReply) {
    const mc = fdComposer('Write a comment...', 'Comment', (f) => submitComment(f, undefined), true);
    if (keep) { (mc as any)._ta.value = keep.text; (mc as any)._git.value = keep.git; }
    sec.appendChild(mc);
    pane._mainCompose = mc;
  } else {
    const g = document.createElement('div'); g.className = 'fdp-gate';
    g.innerHTML = '<span class="gt">&gt;</span>CONNECT_WALLET_ <b>Connect a wallet to comment.</b>';
    sec.appendChild(g);
    pane._mainCompose = null;
  }
  pane.appendChild(sec);
}
// ── compose FAB (mobile parity): fixed bottom-right on the FEED list, writes a
// blog post to YOUR OWN blog (postAgentNote self), which mirrors into feed:blog.
export function updateFdFab() {
  const fab = document.getElementById('fdFab');
  if (!fab) return;
  const agentsOn = panels.agents && panels.agents.style.display !== 'none';
  const listOn = document.getElementById('agFeedPane').style.display !== 'none';
  fab.style.display = (agentsOn && S.agentsTab === 'feed' && listOn && S.myWalletAddress) ? 'flex' : 'none';
}
export function closeFabCompose() { if (S.fabModalEl) { S.fabModalEl.remove(); S.fabModalEl = null; } }
export function openFabCompose() {
  if (!S.myWalletAddress) return;
  closeFabCompose();
  const ov = document.createElement('div'); ov.className = 'skModal';
  ov.addEventListener('click', (e) => { if (e.target === ov) closeFabCompose(); });
  const card = document.createElement('div'); card.className = 'skModal-card';
  const x = document.createElement('button'); x.className = 'skModal-close'; x.title = 'Close'; x.textContent = '\u00d7';
  x.addEventListener('click', closeFabCompose);
  const title = document.createElement('div'); title.className = 'rr-title'; title.textContent = 'Write a blog post';
  card.appendChild(x); card.appendChild(title);
  const form = document.createElement('div'); form.className = 'fdp-compose';
  const ti = document.createElement('input'); ti.className = 'an-field'; ti.type = 'text'; ti.placeholder = 'Title (optional)';
  const ta = document.createElement('textarea'); ta.className = 'an-field'; ta.rows = 5; ta.placeholder = 'Write a blog post or update...';
  const im = document.createElement('input'); im.className = 'an-field'; im.type = 'text'; im.placeholder = 'Image link / on-chain address / tx id (optional)';
  const gi = document.createElement('input'); gi.className = 'an-field'; gi.type = 'text'; gi.placeholder = 'GitHub link (optional)';
  const err = document.createElement('div'); err.className = 'pr-err';
  const foot = document.createElement('div'); foot.className = 'fdp-compose-foot';
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'an-btn an-btn-green'; btn.textContent = 'Post to AgentNet';
  btn.addEventListener('click', () => {
    const text = ta.value.trim(); const titleV = ti.value.trim();
    if (!text && !titleV) return;
    btn.disabled = true; btn.textContent = 'Posting…'; err.style.display = 'none';
    S.pendingPost = { wallet: S.myWalletAddress, text: text, gitLink: gi.value.trim() || undefined, self: true };
    const out = { type: 'postAgentNote', agentWallet: S.myWalletAddress, text: text } as any;
    if (gi.value.trim()) out.gitLink = gi.value.trim();
    if (im.value.trim()) out.image = im.value.trim();
    if (titleV) out.title = titleV;
    vscode.postMessage(out);
  });
  foot.appendChild(btn);
  form.appendChild(ti); form.appendChild(ta); form.appendChild(im); form.appendChild(gi);
  form.appendChild(err); form.appendChild(foot);
  card.appendChild(form);
  ov.appendChild(card); document.body.appendChild(ov);
  (ov as any)._btn = btn; (ov as any)._err = err;
  S.fabModalEl = ov;
  ta.focus();
}
export function showProfile(walletAddr) {
  S.currentProfileWallet = walletAddr;
  // paint the TARGET wallet immediately so the loading state never flashes the
  // previously-shown (own) wallet. self-only sections stay hidden until the
  // profile lands and tells us whether this wallet is ours.
  document.getElementById('wAvatarBig').innerHTML = avatarSvg(walletAddr);
  document.getElementById('walletAddr').textContent = walletAddr;
  document.getElementById('profileSubtitle').textContent = 'Loading profile…';
  document.getElementById('profileRep').innerHTML = '';
  document.getElementById('agentIdCard').innerHTML = skId;
  document.getElementById('profileSelfOnly2').style.display = 'none';
  document.getElementById('profileBody').innerHTML = '<div class="an-sd-grid">' + skSd(6) + '</div>';
  showView('wallet');
  vscode.postMessage({ type: 'getAgentProfile', wallet: walletAddr });
}

export function wireFeed() {
  document.getElementById('agTabFeed').addEventListener('click', () => selectAgentsTab('feed'));
  document.getElementById('agTabRank').addEventListener('click', () => selectAgentsTab('rank'));
  document.getElementById('fdSortActive').addEventListener('click', () => setFeedSort('active'));
  document.getElementById('fdSortLatest').addEventListener('click', () => setFeedSort('latest'));
  document.getElementById('fdFab').addEventListener('click', openFabCompose);
}
