// SVG glyphs shared by the HTML shell (webview.ts markup) and the panel bundle (market.ts).
// Plain string constants, so the node host and the browser bundle inline the same bytes.

// A small magic-wand glyph (line art, currentColor) — the skills affordance. Drawn
// as SVG instead of an emoji so it matches the UI weight and themes cleanly.
export const WAND_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13l7-7"/><path d="M9.5 4.5l2 2"/><path d="M12.5 2v2M14.5 3.5h-2M13 6.2l1 .4M12.6 1.2l.4 1"/></svg>';
export const PAPERCLIP_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 6.5l-5.6 5.6a2.5 2.5 0 0 1-3.5-3.5L9 3a1.7 1.7 0 0 1 2.4 2.4l-5.4 5.4a0.85 0.85 0 0 1-1.2-1.2l5-5"/></svg>';
// A stacked-layers glyph — the workflow affordance (a workflow composes several skills),
// distinct from the single-skill wand so workflows read as "crafted/composite" at a glance.
export const LAYERS_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.8l5.8 3L8 7.8 2.2 4.8 8 1.8z"/><path d="M2.2 8L8 11l5.8-3"/><path d="M2.2 11.2L8 14.2l5.8-3"/></svg>';
