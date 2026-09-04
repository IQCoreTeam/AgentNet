// Panel module cut from the legacy webview script (issue #215). Bodies are verbatim apart from
// the S.<name> state rewrite; the GitHub link parser is core's (links/github.ts, plan section 5).
import { S } from "./state.js";
import { parseGithubLink, safeExternalUrl } from "../../../links/github.js";
import { avatarSvg } from "../avatar.js";
import { agStarTier, agNextTierMin, AG_SEG, agAccent } from "./tiers.js";
import { agShort } from "./format.js";
import { showProfile } from "./feed.js";

// ── issue #35: agent directory — cyberpunk cards (ported from the mobile .an-ac) ──
// The ONE tier axis is verified-work stars (copies deliberately don't buy a tier), with
// the same --an-tier-* thresholds the profile gauge uses, so an agent reads the same tier
// on their card and on their page.

export function agentCardEl(agent, self) {
  const stars = agent.stars || 0;
  const tier = agStarTier(stars);
  const isMax = tier && tier.name === 'Legendary';
  const denom = agNextTierMin(stars);
  const filled = Math.max(0, Math.min(AG_SEG, Math.round((stars / denom) * AG_SEG)));
  const tierName = (tier ? tier.name : 'Unranked').toUpperCase();
  const created = agent.skillsPublished || 0;
  const copies = agent.totalSupply || 0;
  const earnedSol = agent.totalEarned ? Number(agent.totalEarned) / 1e9 : 0;
  const earned = earnedSol >= 100 ? earnedSol.toFixed(0) : earnedSol.toFixed(2);
  const sig = 34 + (agent.wallet.charCodeAt(2) % 6) * 11; // decorative battery fill
  let segs = '';
  for (let i = 0; i < AG_SEG; i++) segs += '<i class="' + (i < filled ? 'on' : '') + '"></i>';
  // wallet addresses are base58 (no HTML-special chars), so direct interpolation is safe.
  const btn = document.createElement('button');
  btn.className = 'an-ac' + (self ? ' is-self' : '');
  btn.style.setProperty('--accent', agAccent(agent.wallet));
  btn.innerHTML =
    '<div class="an-ac-in">' +
      '<div class="an-ac-top">' +
        '<span class="an-ac-hand">&gt;' + agShort(agent.wallet).toUpperCase() + '_AGENT' + (self ? '<span class="an-ac-you"> // YOU</span>' : '') + '</span>' +
        '<span class="an-ac-sig">SIGNAL <span class="an-ac-batt"><i style="width:' + sig + '%"></i></span></span>' +
      '</div>' +
      '<div class="an-ac-namerow">' +
        '<div><div class="an-ac-kana">エージェント</div><div class="an-ac-name">' + agent.wallet.slice(0, 6).toUpperCase() + '</div></div>' +
        '<div class="an-ac-access">アクセス / ACCESS<br><span class="an-ac-tier' + (tier ? '' : ' unranked') + '">' + tierName + '</span></div>' +
      '</div>' +
      '<div class="an-ac-body">' +
        '<div class="an-ac-ava">' + avatarSvg(agent.wallet) + '</div>' +
        '<div class="an-ac-attr">' +
          '<div><div class="an-ac-rank">&mdash; RANKING &mdash;</div>' +
            '<div class="an-ac-gauge"><span class="lab">STARS</span><span class="an-ac-segs">' + segs + '</span>' +
            '<span class="val">' + (isMax ? stars : stars + '/' + denom) + '</span></div></div>' +
          '<div class="an-ac-stats">' +
            '<div class="an-ac-stat"><div class="k">CREATED</div><div class="v">' + created + '</div></div>' +
            '<div class="an-ac-stat"><div class="k">COPIES</div><div class="v">' + copies + '</div></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="an-ac-foot"><span class="an-ac-box"></span><span>&gt;EARNED <span class="earn">' + earned + '&#9678;</span></span><span class="an-ac-box"></span></div>' +
    '</div>';
  btn.addEventListener('click', () => showProfile(agent.wallet));
  return btn;
}

export function renderAgents(agents) {
  S.lastAgents = agents || [];
  // your own agent pinned at the top: from the leaderboard if it ranks, else a zero-stat
  // placeholder so "me" is always present and tappable (the profile fills in real stats).
  const selfEl = document.getElementById('agentsSelf');
  if (selfEl) {
    selfEl.innerHTML = '';
    if (S.myWalletAddress) {
      const selfRep = S.lastAgents.find((a) => a.wallet === S.myWalletAddress) ||
        { wallet: S.myWalletAddress, skillsPublished: 0, totalSupply: 0, notesReceived: 0, updatedAt: 0 };
      selfEl.appendChild(agentCardEl(selfRep, true));
    }
  }
  const search = document.getElementById('agentSearch');
  if (search && !(search as any)._wired) { (search as any)._wired = true; search.addEventListener('input', renderAgentsList); }
  renderAgentsList();
}
export function renderAgentsList() {
  const el = document.getElementById('agentsList');
  if (!el) return;
  const searchEl = document.getElementById('agentSearch') as HTMLInputElement;
  const ql = (searchEl && searchEl.value ? searchEl.value : '').trim().toLowerCase();
  let others = S.lastAgents.filter((a) => a.wallet !== S.myWalletAddress);
  if (ql) others = others.filter((a) => a.wallet.toLowerCase().includes(ql));
  el.innerHTML = '';
  if (!others.length) {
    const e = document.createElement('div'); e.className = 'agEmpty';
    e.textContent = ql ? 'No agent matches that wallet' : 'No other agents yet';
    el.appendChild(e); return;
  }
  others.forEach((a) => el.appendChild(agentCardEl(a, false)));
}
// Optimistic blog/comment posts. On-chain note reads lag a few seconds, so the
// profile the host re-pushes right after posting won't include the new note yet —
// without this the post would silently vanish ("I wrote it but nothing happened").
// We hold the just-posted note here and merge it in on every render until the real
// read catches up (deduped by author+text), pruning anything older than 60s.
// Active profile tab — persisted across renders so the post-and-re-push (which rebuilds
// the whole pane) doesn't yank the user from Notes back to Skills ("bounce to top").
export function mergeOptimistic(profile) {
  const now = Date.now();
  S.recentlyPosted = S.recentlyPosted.filter((p) => now - p.ts < 60000);
  const real = new Set((profile.threads || []).flatMap((t) => [t.note, ...(t.replies || [])]).map((n) => (n.author || '') + '\0' + (n.text || '')));
  // drop optimistic notes the real read now includes (self-heal)
  S.recentlyPosted = S.recentlyPosted.filter((p) => !(p.wallet === profile.wallet && real.has((p.note.author || '') + '\0' + (p.note.text || ''))));
  const pending = S.recentlyPosted.filter((p) => p.wallet === profile.wallet && !p.note.parentId).map((p) => p.note);
  return pending.length ? { ...profile, threads: [...pending.map((note) => ({ note, replies: [] })), ...(profile.threads || [])] } : profile;
}
export function feedbackFor(wallet) {
  if (!S.postFeedback) return null;
  if (S.postFeedback.wallet !== wallet) return null;
  if (Date.now() - S.postFeedback.ts > 8000) {
    S.postFeedback = null;
    return null;
  }
  return S.postFeedback;
}
// Click-and-drag horizontal scrolling for the blog carousel. Mouse only — touch
// already scrolls natively. Pointer capture keeps the drag alive past the element's
// edge without leaking window listeners (handlers are scoped to el, GC'd on re-render).
// A drag past 3px swallows the trailing click so card tx/git links don't fire mid-drag.
export function enableDragScroll(el) {
  let startX = 0, startLeft = 0, dragging = false, moved = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    dragging = true; moved = false; startX = e.clientX; startLeft = el.scrollLeft;
    try { el.setPointerCapture(e.pointerId); } catch {}
    el.classList.add('dragging');
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 3) moved = true;
    el.scrollLeft = startLeft - dx;
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false; el.classList.remove('dragging');
    try { el.releasePointerCapture(e.pointerId); } catch {}
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('click', (e) => {
    if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; }
  }, true);
}
// core's parseGithubLink names the kind (repo/pull/commit/blob); the card shows the words the
// panel always displayed, so the mapping sits at its single use.
export const GH_KIND_LABEL = { repo: 'Repo', pull: 'PR', commit: 'Commit', blob: 'File' };
export function gitLinkNode(raw, className) {
  const gh = parseGithubLink(raw);
  const wrap = document.createElement('div'); wrap.className = className;
  if (gh) {
    const a = document.createElement('a'); a.className = 'gh-card'; a.href = gh.href;
    a.target = '_blank'; a.rel = 'noopener noreferrer';
    const kind = document.createElement('span'); kind.className = 'gh-kind'; kind.textContent = GH_KIND_LABEL[gh.kind];
    const title = document.createElement('span'); title.className = 'gh-title'; title.textContent = gh.label;
    const meta = document.createElement('span'); meta.className = 'gh-meta'; meta.textContent = gh.meta;
    a.appendChild(kind); a.appendChild(title); a.appendChild(meta); wrap.appendChild(a);
    return wrap;
  }
  const safeLink = safeExternalUrl(raw);
  if (!safeLink) return null;
  const a = document.createElement('a'); a.href = safeLink; a.textContent = safeLink;
  a.target = '_blank'; a.rel = 'noopener noreferrer'; wrap.appendChild(a);
  return wrap;
}
