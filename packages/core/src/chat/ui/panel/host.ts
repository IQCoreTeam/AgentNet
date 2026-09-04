// acquireVsCodeApi is injected by VS Code only, so it is declared (erasable) rather than
// imported. The browser/Android fallback below runs at module evaluation (it opens the SSE
// stream), which is why no node unit spec imports this module.
declare const acquireVsCodeApi: (() => any) | undefined;
// The host pipe. Inside VSCode it's acquireVsCodeApi(); in a browser/Android WebView
// there's no such global, so we fall back to HTTP-RPC + SSE that speaks the SAME
// shape: postMessage(obj) → POST /rpc (UI→server commands); the server's SSE stream
// (GET /events, server→UI) is re-dispatched as window 'message' events. So every
// `vscode.postMessage(...)` and `addEventListener('message',...)` below works
// unchanged on any surface (CODE-RULES: one UI, no per-platform fork). SSE auto-
// reconnects; we keep the server-issued client id so a dropped stream replays the
// events it missed (steadier than WebSocket in an Android WebView).
export const vscode = (typeof acquireVsCodeApi === "function")
  ? acquireVsCodeApi()
  : (() => {
      let clientId = null;
      const outbox = []; // commands queued until we have a client id
      function post(s) {
        fetch("/rpc?client=" + encodeURIComponent(clientId), {
          method: "POST", headers: { "content-type": "application/json" }, body: s,
        }).catch(() => {}); // a dropped command is recovered by the UI's next action
      }
      // Open the SSE stream. On the first connect the server sends {client} which we
      // tag onto every POST; we then reopen the stream WITH the id in the URL so the
      // browser's auto-reconnect (carrying Last-Event-ID) lands on the same client
      // and replays. Inbound data frames become window 'message' events.
      function open(url) {
        const es = new EventSource(url);
        es.addEventListener("client", (e) => {
          const id = JSON.parse(e.data).client;
          if (clientId === null) {
            clientId = id;
            es.close(); // reopen with the id so reconnects stay on this client
            open("/events?client=" + encodeURIComponent(id));
            for (const m of outbox.splice(0)) post(m); // flush queued commands
          }
        });
        es.onmessage = (e) => window.dispatchEvent(new MessageEvent("message", { data: JSON.parse(e.data) }));
      }
      open("/events");
      return {
        postMessage: (obj) => {
          const s = JSON.stringify(obj);
          if (clientId !== null) post(s); else outbox.push(s);
        },
      };
    })();
// small view prefs persist via the VSCode webview state; the browser fallback has no
// state API, so these are guarded no-ops there (the pref just resets to default on reload).
export function uiGet(k) { try { const s = vscode.getState && vscode.getState(); return s ? s[k] : undefined; } catch (e) { return undefined; } }
export function uiSet(k, v) { try { if (!vscode.setState) return; const s = (vscode.getState && vscode.getState()) || {}; s[k] = v; vscode.setState(s); } catch (e) {} }
