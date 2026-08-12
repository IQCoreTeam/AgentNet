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
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{1,5}$/.test(s)) return `http://127.0.0.1:${s}/`;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `http://${s}`);
  } catch {
    return null;
  }
  const host = u.hostname;
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  return loopback ? u.toString() : null;
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
                  onClick={() => setNonce((n) => n + 1)}>↻</button>
          <button type="button" className="an-preview-btn" aria-label="Open externally" disabled={!url}
                  onClick={() => { if (url) openExternalUrl(url); }}>↗</button>
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
              <p className="dim an-preview-hint">agent: POST http://127.0.0.1:4317/preview/announce {'{'}"port": 5173{'}'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
