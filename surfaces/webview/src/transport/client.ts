// The single seam between this UI and core. Talks surfaces/localhost's transport:
//   server→UI : SSE on GET /events   (first frame is `event: client {client:id}`)
//   UI→server : POST /rpc?client=<id>  (body = a ClientMessage)
//
// surfaces/localhost numbers every data frame (`id: N`) and keeps a per-client replay
// buffer, so after a dropped stream we reopen /events?client=<id>&cursor=<lastId> and
// it re-emits what we missed — no lost events across a brief WebView/network blip. The
// EventSource auto-reconnects on its own, but it would open a FRESH client; we want the
// SAME one, so we manage reconnection manually with the cursor.

import type { ClientMessage, ServerMessage } from "./protocol";

type Listener = (msg: ServerMessage) => void;

export class Transport {
  private clientId: string | null = null;
  private lastEventId = 0;
  private es: EventSource | null = null;
  private listeners = new Set<Listener>();
  private closed = false;

  /** The SSE client id (null until the handshake lands). Native notification actions POST
   *  to /rpc?client=<id> with it, so the Android shell needs to read it. */
  getClientId(): string | null {
    return this.clientId;
  }

  /** Subscribe to server→UI events. Returns an unsubscribe fn. */
  onEvent(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Open the SSE stream (idempotent). Call once on app start. */
  open(): void {
    this.closed = false;
    this.connect();
  }

  /** Drop the current client and open a brand-new SSE stream. Used after onboarding:
   *  the first stream attached the ONBOARDING handler (no runtime yet); once the wallet
   *  is connected the runtime exists, so a fresh stream attaches the CHAT dispatcher.
   *  (The server keys chat-vs-onboarding on "did a runtime exist when /events opened".)
   *  A React SPA never navigates, so without this the onboarding client would keep
   *  handling chat messages — i.e. silently drop every `send`. */
  reopen(): void {
    this.es?.close();
    this.es = null;
    this.clientId = null;
    this.lastEventId = 0;
    this.connect();
  }

  /** Send one UI→server command. No-op until the client id handshake completes. */
  async post(msg: ClientMessage): Promise<void> {
    if (!this.clientId) {
      // Shouldn't happen in normal flow (UI actions come after the stream is up), but
      // guard so an early click doesn't 409. Wait briefly for the id, then send.
      await this.waitForId();
    }
    await fetch(`/rpc?client=${encodeURIComponent(this.clientId!)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(msg),
    });
  }

  close(): void {
    this.closed = true;
    this.es?.close();
    this.es = null;
  }

  // ── internals ──

  private connect(): void {
    const q = this.clientId
      ? `?client=${encodeURIComponent(this.clientId)}&cursor=${this.lastEventId}`
      : "";
    const es = new EventSource(`/events${q}`);
    this.es = es;

    // The handshake frame (`event: client`) carries our id. On a reconnect the server
    // echoes the same id back; on a fresh open it mints a new one.
    es.addEventListener("client", (e) => {
      try {
        this.clientId = JSON.parse((e as MessageEvent).data).client;
      } catch {
        /* ignore malformed handshake */
      }
    });

    // Every numbered data frame is a ServerMessage. Track its id for replay-on-reconnect.
    es.onmessage = (e) => {
      if (e.lastEventId) this.lastEventId = Number(e.lastEventId) || this.lastEventId;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return; // skip garbage, keep the stream alive
      }
      for (const cb of this.listeners) cb(msg);
    };

    // EventSource retries internally, but to preserve our client id + cursor we close it
    // and reopen with the query params ourselves.
    es.onerror = () => {
      es.close();
      this.es = null;
      if (this.closed) return;
      setTimeout(() => {
        if (!this.closed) this.connect();
      }, 1000);
    };
  }

  private waitForId(): Promise<void> {
    return new Promise((resolve) => {
      const tick = () => {
        if (this.clientId || this.closed) resolve();
        else setTimeout(tick, 50);
      };
      tick();
    });
  }
}
