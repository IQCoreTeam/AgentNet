import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { openExternalUrl } from "../platform/openExternalUrl";

// Normalize what the user types into a loopback URL:
//   "5173"                   -> http://127.0.0.1:5173/
//   "127.0.0.1:5173"         -> http://127.0.0.1:5173/
//   "http://localhost:3000"  -> kept as-is
// Any non-loopback host returns null (rejected) — the preview only ever frames the
// device's own localhost, matching the WebView's trust model (MainActivity keeps
// loopback in-WebView and blocks the rest).
export function normalizePreviewUrl(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (/^\d{1,5}$/.test(s)) {
    const p = Number(s);
    if (!(p >= 1 && p <= 65535)) return null;
    s = `http://127.0.0.1:${p}/`;
  }
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `http://${s}`);
  } catch {
    return null;
  }
  // ::1 is deliberately not accepted — the server only ever announces 127.0.0.1.
  const host = u.hostname;
  const loopback = host === "127.0.0.1" || host === "localhost";
  if (!loopback) return null;
  // Never frame the app itself (mirrors the server's `raw === serverPort` rejection).
  if (u.host === window.location.host) return null;
  return u.toString();
}

// Bar-button glyphs, matching TabBar.tsx's style (16px, stroke currentColor, width 1.8).
function ReloadGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 3v5h-5" />
    </svg>
  );
}
function OpenExternalGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
    </svg>
  );
}

// The PREVIEW tab: an <iframe> pointed at a loopback dev server the agent (or the user)
// is running, plus a small URL bar (enter a port, reload, open externally). Direct
// cross-origin iframe — no proxy — so the dev server's own HMR reloads it for free.
export function PreviewScreen() {
  const { state, send } = useStore();
  const [input, setInput] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0); // bump to force the iframe to reload
  const [dirty, setDirty] = useState(false); // user typed a URL → stop auto-adopting the announced one
  const [error, setError] = useState<string | null>(null);

  // Ask the server for the current preview target on mount: an announce can arrive
  // (and its SSE event fire) before this tab is first opened. Mirrors MarketScreen's
  // mount effect.
  useEffect(() => {
    send({ type: "getPreviewStatus" });
  }, [send]);

  // A loopback link tapped in the chat routes here (Markdown.tsx dispatches the event;
  // the shell has already switched to this tab).
  useEffect(() => {
    const onOpen = (e: Event) => {
      const raw = (e as CustomEvent<{ url: string }>).detail?.url;
      const normalized = raw ? normalizePreviewUrl(raw) : null;
      if (!normalized) return;
      setError(null);
      setDirty(true);
      setUrl(normalized);
      setInput(normalized);
      setNonce((n) => n + 1);
    };
    window.addEventListener("agentnet:openPreview", onOpen);
    return () => window.removeEventListener("agentnet:openPreview", onOpen);
  }, []);

  // Adopt the agent-announced URL unless the user has taken manual control.
  useEffect(() => {
    if (dirty) return;
    const announced = state.preview.url;
    if (announced && announced !== url) {
      setUrl(announced);
      setInput(announced);
      setNonce((n) => n + 1);
    }
  }, [state.preview.url, dirty, url]);

  function go(raw: string) {
    const normalized = normalizePreviewUrl(raw);
    if (!normalized) {
      setError("Enter a loopback port or URL — e.g. 5173 or http://127.0.0.1:5173");
      return;
    }
    setError(null);
    setDirty(true);
    setUrl(normalized);
    setInput(normalized);
    setNonce((n) => n + 1);
  }

  return (
    <div className="an-page">
      <div className="an-preview">
        <div className="an-preview-bar" data-no-swipe>
          <input
            className="an-preview-url"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") go(input); }}
            placeholder="port or http://127.0.0.1:…"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button type="button" className="an-preview-btn" onClick={() => go(input)}>GO</button>
          <button type="button" className="an-preview-btn" aria-label="Reload" disabled={!url}
                  onClick={() => setNonce((n) => n + 1)}><ReloadGlyph /></button>
          <button type="button" className="an-preview-btn" aria-label="Open externally" disabled={!url}
                  onClick={() => { if (url) openExternalUrl(url); }}><OpenExternalGlyph /></button>
        </div>
        {error && <div className="an-preview-error">{error}</div>}
        <div className="an-preview-frame">
          {url ? (
            <iframe
              key={url + "#" + nonce}
              src={url}
              title="preview"
              sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
              style={{ width: "100%", height: "100%", border: 0, background: "#fff" }}
            />
          ) : (
            <div className="an-preview-empty">
              <p className="an-preview-empty-title">No preview yet</p>
              <p className="dim">Ask the agent to start a dev server and announce it, or type a port above.</p>
              <p className="dim an-preview-hint">agent: POST {window.location.origin}/preview/announce {'{'}"port": 5173{'}'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
