// Quote refs (the feed's hyperlink): ">>note:<wallet>:<ms>:<nonce>" inside a note's
// text points at another note. The ref IS the note id, so it already carries the
// author wallet and the row key; a surface resolves it through the SAME spoof-proof
// read every post open uses (readBlogPost: the author's own table is the truth, the
// anchor is permissionless), and renders the result as an inline quote card. Pure
// text convention: nothing new on chain, no contract or seed change, a miss is a
// deadlink, not an error. Descends from blockchan's ">>txSignature" quotelinks,
// which only resolve inside one loaded page; the note id makes the quote portable
// across threads, boards, and surfaces.

// One ref: ">>" + a note id as buildNote mints them:
// note:<base58 wallet (32-44)>:<unix ms>:<nonce>. The nonce is
// Math.random().toString(36).slice(2, 8): lowercase base36, six chars in practice
// but shorter when the random tail is, so 4-6 (slice(2, 8) caps at 6). The trailing lookahead refuses a
// ref glued to alphanumeric text: a corrupted id would fetch a nonexistent post
// and render a deadlink for a ref that actually resolves, so no match is safer.
// The VS Code panel template cannot import this (it is emitted browser JS), so
// webview.ts carries a byte-identical copy: change BOTH or the surfaces diverge.
const QUOTE_REF = />>(note:([1-9A-HJ-NP-Za-km-z]{32,44}):(\d{10,16}):([a-z0-9]{4,6}))(?![A-Za-z0-9])/g;

export interface QuoteRef {
  ref: string; // the full note id ("note:...:...:...")
  author: string; // the wallet segment, ready for readBlogPost(author, ref)
}

// How many refs one note may hydrate. Quotes resolve lazily on view, but each one
// is still a read; the cap keeps a pathological note from fanning out unbounded.
export const QUOTE_REFS_MAX = 4;

/** Every unique quote ref in a note's text, in order of first appearance, capped. */
export function extractQuoteRefs(text: string | undefined): QuoteRef[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: QuoteRef[] = [];
  for (const m of text.matchAll(QUOTE_REF)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ ref: m[1], author: m[2] });
    if (out.length >= QUOTE_REFS_MAX) break;
  }
  return out;
}

/** Parse one bare note id (no ">>") into a QuoteRef, or null when it is not one. */
export function parseNoteRef(id: string | undefined): QuoteRef | null {
  if (!id) return null;
  const refs = extractQuoteRefs(`>>${id}`);
  return refs.length === 1 && refs[0].ref === id ? refs[0] : null;
}
