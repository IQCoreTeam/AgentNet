// Markdown rendering shared with the vscode HTML webview: we evaluate core's MD_LIBS
// (the marked + dompurify browser builds, bundled once in packages/core) to get
// window.marked / window.DOMPurify, then render exactly as webview.ts does —
// DOMPurify.sanitize(marked.parse(text)). One markdown engine across both surfaces; no
// react-markdown / starry-night dependency.

// Subpath import (not the barrel): the core index pulls in node-only modules (fs,
// child_process, the SDK) that can't bundle for the browser. We need only this one pure
// string constant, so import the leaf file directly.
import { MD_LIBS } from "@iqlabs-official/agent-sdk/chat/ui/mdLibs.generated";

interface MdGlobals {
  marked?: { parse(s: string): string; setOptions(o: object): void };
  DOMPurify?: { sanitize(html: string): string };
}

let ready = false;

function ensureLibs(): MdGlobals {
  const w = window as unknown as MdGlobals;
  if (!ready) {
    try {
      // MD_LIBS is the concatenated UMD builds; running it attaches marked + DOMPurify
      // to window. new Function avoids leaking our module scope into the eval.
      new Function(MD_LIBS)();
      w.marked?.setOptions({ breaks: true, gfm: true });
    } catch {
      /* leave marked/DOMPurify undefined → renderMarkdown falls back to plain text */
    }
    ready = true;
  }
  return w;
}

/** Render markdown to sanitized HTML. Falls back to the raw text if the libs failed. */
export function renderMarkdown(text: string): string {
  const { marked, DOMPurify } = ensureLibs();
  if (!marked || !DOMPurify) return escapeHtml(text);
  try {
    return DOMPurify.sanitize(marked.parse(text));
  } catch {
    return escapeHtml(text);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
