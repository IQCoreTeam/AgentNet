// Panel module cut from the legacy webview script (issue #215). Bodies are verbatim apart from
// the S.<name> state rewrite and the quote grammar, which is now core's (notes/quoteRefs.ts,
// plan section 5) instead of a pinned copy.
import { S } from "./state.js";
import { splitQuoteRefs, parseNoteRef, QUOTE_REFS_MAX } from "../../../notes/quoteRefs.js";
import { vscode } from "./host.js";
import { agShort, fmtNoteDate } from "./format.js";
import { quoteCardModel } from "./quoteCard.js";
import { openFeedPost } from "./feed.js";
import type { Note } from "../../../core/types.js";

// ── quote refs: ">>note:<wallet>:<ts>:<rand>" in a post body or comment is an
// on-chain quote-tweet, hydrated through the EXISTING getBlogPost/blogPost pair
// (zero new message types): the ref itself carries the author (wallet segment)
// and the postId (the whole "note:..." string after the ">>").
// The grammar and the read cap (QUOTE_REFS_MAX) are core's, so every surface resolves the
// same refs; the per-view accounting (quoteSeen/quoteSlots in S) is the panel's own.
export const quoteCache: Record<string, { post: Note | null } | undefined> = {}; // postId -> resolved post (null = deadlink)
export const quoteInflight: Record<string, true | undefined> = {}; // postId -> true while its getBlogPost is out
export function fillQuoteCard(el: HTMLDivElement, id: Note['id'], post: Note | null) {
  el.textContent = '';
  el.classList.remove('fdq-loading');
  if (!post) {
    // deadlink: keep the raw ref text, dim, with a note (still legible/copyable)
    el.classList.add('fdq-dead');
    el.textContent = '>>' + id + ' [not found]';
    return;
  }
  const top = document.createElement('div'); top.className = 'fdq-top';
  const who = document.createElement('span'); who.textContent = '>>' + agShort(post.author || (parseNoteRef(id)?.author ?? ''));
  top.appendChild(who);
  const when = fmtNoteDate(post);
  if (when) { const w = document.createElement('span'); w.className = 'fdq-when'; w.textContent = when; top.appendChild(w); }
  el.appendChild(top);
  const { title, snippet: snip } = quoteCardModel(post);
  if (title) { const t = document.createElement('p'); t.className = 'fdq-title'; t.textContent = title; el.appendChild(t); }
  if (snip) { const s = document.createElement('p'); s.className = 'fdq-snip'; s.textContent = snip; el.appendChild(s); }
  el.classList.add('fdq-live');
  el.addEventListener('click', () => openFeedPost(post));
}
// Render text that may contain quote refs: plain segments stay textContent
// (post text is attacker-controlled, never innerHTML), each ref becomes a
// compact inline marker, and per unique ref (capped) a quote card is appended
// directly under the paragraph.
export function appendQuoteText(parent: HTMLElement, text: string, cls: string) {
  const p = document.createElement('p'); p.className = cls;
  const cards = [];
  for (const seg of splitQuoteRefs(String(text))) {
    if ('text' in seg) { p.appendChild(document.createTextNode(seg.text)); continue; }
    const id = seg.ref; // the postId ("note:...")
    const mk = document.createElement('span'); mk.className = 'fd-qref';
    mk.textContent = '>>quote:' + agShort(seg.author);
    mk.title = '>>' + seg.ref;
    p.appendChild(mk);
    if (S.quoteSeen[id] || S.quoteSlots >= QUOTE_REFS_MAX) continue;
    S.quoteSeen[id] = true; S.quoteSlots++;
    const card = document.createElement('div'); card.className = 'fd-quote';
    if (id in quoteCache) {
      fillQuoteCard(card, id, quoteCache[id].post);
    } else {
      card.classList.add('fdq-loading'); card.textContent = '>>resolving quote…';
      (S.quoteCards[id] = S.quoteCards[id] || []).push(card);
      if (!quoteInflight[id]) {
        quoteInflight[id] = true;
        vscode.postMessage({ type: 'getBlogPost', author: seg.author, postId: id });
      }
    }
    cards.push(card);
  }
  parent.appendChild(p);
  cards.forEach((c) => parent.appendChild(c));
}
