// Panel module cut from the legacy webview script (issue #215). Bodies are verbatim apart from
// the S.<name> state rewrite.
import { S } from "./state.js";

// ---- relative time ("3개월", "1일", "방금") ----
export function rel(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return '방금';
  const m = s / 60; if (m < 60) return Math.floor(m) + '분';
  const h = m / 60; if (h < 24) return Math.floor(h) + '시간';
  const d = h / 24; if (d < 30) return Math.floor(d) + '일';
  const mo = d / 30; if (mo < 12) return Math.floor(mo) + '개월';
  return Math.floor(mo / 12) + '년';
}
// an on-chain image value is a base58 txid/PDA — NOT an http url and NOT a *.png/etc.
// (skill-nft-json §3: the value's shape says where it lives, no isOnchain flag).
export function looksOnChain(v) {
  const s = (v || '').trim();
  if (!s) return false;
  if (/^https?:/i.test(s)) return false;
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(s)) return false;
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s); // base58 address shape
}
export function fmtNoteDate(n) {
  const ms = n.__blockTime ? n.__blockTime * 1000 : (n.timestamp || 0);
  if (!ms) return '';
  try { return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return ''; }
}
export function explorerTxUrl(sig) {
  const u = 'https://explorer.solana.com/tx/' + encodeURIComponent(sig);
  return S.rpcNetwork === 'mainnet' ? u : u + '?cluster=' + encodeURIComponent(S.rpcNetwork);
}

// short relative age: 5s / 12m / 5h / 3d / 2w — matches the mobile feed rows
export function fdAgo(ms) {
  if (!ms) return '';
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60); if (m < 60) return m + 'm';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h';
  const d = Math.floor(h / 24); if (d < 7) return d + 'd';
  return Math.floor(d / 7) + 'w';
}
// http(s) images only: the panel has no gateway media resolver, so on-chain
// address / tx-id images (rare) fall back to no cover rather than a broken img.
// Shipped as written: inside the old template literal the intended /^https?:\/\//i lost its
// backslashes (a template's `\/` is just `/`), so this line is the regex /^https?:/ followed
// by a line comment, and every truthy input returns that RegExp. Kept verbatim under the
// port's no-behavior-change rule; the `any` only names that shape (the fix is a follow-up).
export function feedImgUrl(v): any {
  return v && /^https?:///i.test(v) ? v : null;
}
export function agShort(w) { return w.slice(0, 6) + '...' + w.slice(-4); }
export function pad2(n) { return n < 10 ? '0' + n : String(n); }
export function splitSkillDoc(text) {
  text = text || '';
  // strip a leading YAML frontmatter block so the name/description metadata doesn't
  // dominate the popup; the real instructions live in the markdown body below it.
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return (m ? text.slice(m[0].length) : text).trim();
}
export function fmtSol(lamports) {
  if (lamports == null) return null;
  const sol = lamports / 1e9;
  // compact: up to 4 dp, trim trailing zeros (e.g. 1.5 SOL, 0.0123 SOL, 0 SOL)
  const s = sol < 1 ? sol.toFixed(4) : sol.toFixed(3);
  return s.replace(/\.?0+$/, '') + ' SOL';
}
// An item's price (lamports string from chain) → display: "Free" at 0, else SOL.
// null/undefined = price unknown (indexer didn't read it) → no label.
export function fmtPrice(price) {
  if (price == null) return null;
  const n = Number(price);
  if (!Number.isFinite(n)) return null;
  return n === 0 ? 'Free' : fmtSol(n);
}
export function netBadge(network) {
  const n = network === 'mainnet' ? 'mainnet' : 'devnet';
  return '<span class="netBadge ' + n + '">' + n + '</span>';
}
export function short(a) { return a && a.length > 10 ? a.slice(0, 4) + '..' + a.slice(-3) : a; }
