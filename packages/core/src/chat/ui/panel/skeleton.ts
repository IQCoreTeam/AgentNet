// Panel module cut from the legacy webview script (issue #215). Bodies are verbatim apart from
// the S.<name> state rewrite.

// ---- skeleton loaders ----
// Footprints mirror the real cards so swapping skeleton -> content does not jump.
// skSd fills an SD-card grid (skills / workflows / profile skills); skAc fills the
// agent directory list; skId stands in for the profile id-card while it fetches.
export function skSd(n) { let s = ''; for (let i = 0; i < n; i++) s += '<div class="sk-sd sk-sh"></div>'; return s; }
export function skAc(n) { let s = ''; for (let i = 0; i < n; i++) s += '<div class="sk-ac sk-sh"></div>'; return s; }
export const skId = '<div class="sk-id sk-sh"></div>';
export function skFd(n) { let s = ''; for (let i = 0; i < n; i++) s += '<div class="sk-fd sk-sh"></div>'; return s; }
