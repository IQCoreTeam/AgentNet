// Panel module cut from the legacy webview script (issue #215). Bodies are verbatim apart from
// the S.<name> state rewrite.

// ---- markdown rendering (marked + dompurify), with a plain-text fallback ----
export const MD_OK = !!((window as any).marked && (window as any).DOMPurify);
if (MD_OK) (window as any).marked.setOptions({ breaks: true, gfm: true });
// SVG copy/check glyphs + clipboard write, used by the code copy affordances.
export const COPY_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"/></svg>';
export const CHECK_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.5 3.5L13 5"/></svg>';
// Copy text, then call done() so the caller can show it landed (a block button swaps
// its glyph, an inline span flashes). execCommand is the fallback for webviews where
// the async clipboard API is unavailable.
export function copyText(text, done) {
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => {});
  else { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
    ta.select(); try { document.execCommand('copy'); done(); } catch (e2) {} document.body.removeChild(ta); }
}
// Give every fenced code block its own copy button, revealed on hovering that block.
// The pre gets wrapped because it scrolls horizontally: anchoring the button to the
// wrapper keeps it pinned at the top-right instead of sliding away with wide code.
export function addPreCopyButtons(root) {
  const pres = root.querySelectorAll('pre');
  for (let i = 0; i < pres.length; i++) {
    const pre = pres[i];
    if (!pre.parentNode || (pre.parentNode.classList && pre.parentNode.classList.contains('preWrap'))) continue;
    const wrap = document.createElement('div');
    wrap.className = 'preWrap';
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);
    const btn = document.createElement('button');
    btn.className = 'preCopy'; btn.title = 'Copy code'; btn.innerHTML = COPY_ICON;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const code = pre.querySelector('code'); // the fence body, without the button
      copyText((code || pre).textContent || '', () => {
        btn.classList.add('done'); btn.innerHTML = CHECK_ICON;
        setTimeout(() => { btn.classList.remove('done'); btn.innerHTML = COPY_ICON; }, 1200);
      });
    });
    wrap.appendChild(btn);
  }
}

// Inline code spans (a URL, a command, a path) are copyable too, but they sit in the
// middle of a sentence: a floating button would either shove the surrounding words
// aside or cover them, so the span itself is the button. Hover tints it, clicking
// copies, and it flashes green in place, which costs no layout. Fenced blocks keep
// their own button, and code inside a link is skipped so the click still navigates.
export function addInlineCopy(root) {
  const codes = root.querySelectorAll('code');
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code.closest('pre') || code.closest('a') || code.classList.contains('inlineCopy')) continue;
    code.classList.add('inlineCopy');
    code.title = 'Click to copy';
    code.addEventListener('click', () => {
      // Dragging out part of a URL ends in a click here too; copying the whole span
      // then would clobber the selection the user just made, so leave it alone.
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      copyText(code.textContent || '', () => {
        code.classList.add('done');
        setTimeout(() => code.classList.remove('done'), 1200);
      });
    });
  }
}

// Render md text into el's innerHTML (sanitized). Falls back to textContent if the
// libs didn't load. We keep the raw md on el.dataset.md so copy yields the source.
export function renderMd(el, text) {
  el.dataset.md = text;
  // whole-subtree replace below: any incremental stream state now points at dead nodes
  el._mdDone = null; el._mdTail = null; el._mdTailRaw = null;
  if (!MD_OK) { el.textContent = text; return; }
  try { el.innerHTML = (window as any).DOMPurify.sanitize((window as any).marked.parse(text)); addPreCopyButtons(el); addInlineCopy(el); }
  catch (e) { el.textContent = text; }
}

// Live-stream variant of renderMd. Markdown arrives append-only, so every block
// except the growing tail is already final: freeze finished blocks into .mdChunk
// children once, and re-parse/sanitize ONLY the tail block on each flush. That turns
// the per-flush cost from O(whole reply) into O(last block) — the full innerHTML
// swap was the long task that saturated the shared webview renderer and lagged
// typing while a long reply streamed. The lexer still scans the full text each flush
// (no DOM work, cheap). If a later chunk legitimately rewrites an already-frozen
// block (e.g. two streamed list chunks merging into one loose list), the raw-prefix
// comparison catches it and we rebuild from scratch — one old-style full render.
// The partial:false path still renders the finished text via renderMd's whole-document
// parse, so the final DOM is identical to the pre-incremental behavior (including
// cross-block reference links, which per-block parsing can't resolve mid-stream).
export function renderMdStreaming(el, text) {
  el.dataset.md = text;
  if (!MD_OK) { el.textContent = text; return; }
  try {
    const tokens = (window as any).marked.lexer(text);
    const stable = Math.max(0, tokens.length - 1); // the last token may still grow
    let done = el._mdDone;
    let ok = !!done && done.length <= stable;
    for (let i = 0; ok && i < done.length; i++) if (tokens[i].raw !== done[i]) ok = false;
    if (!ok) { el.innerHTML = ''; el._mdDone = done = []; el._mdTail = null; el._mdTailRaw = null; }
    if (!el._mdTail) {
      el._mdTail = document.createElement('div');
      el._mdTail.className = 'mdChunk';
      el._mdTailRaw = null;
      el.appendChild(el._mdTail);
    }
    for (let i = done.length; i < stable; i++) {
      const div = document.createElement('div');
      div.className = 'mdChunk';
      div.innerHTML = (window as any).DOMPurify.sanitize((window as any).marked.parse(tokens[i].raw));
      addPreCopyButtons(div); addInlineCopy(div);
      el.insertBefore(div, el._mdTail);
      done.push(tokens[i].raw);
    }
    const tailRaw = stable < tokens.length ? tokens[stable].raw : '';
    if (tailRaw !== el._mdTailRaw) {
      el._mdTail.innerHTML = (window as any).DOMPurify.sanitize((window as any).marked.parse(tailRaw));
      addPreCopyButtons(el._mdTail); addInlineCopy(el._mdTail);
      el._mdTailRaw = tailRaw;
    }
  } catch (e) { el.textContent = text; el._mdDone = null; el._mdTail = null; el._mdTailRaw = null; }
}
export function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
