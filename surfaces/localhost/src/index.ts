// AgentNet localhost surface — the HTTP form of vscode's extension host.
// NOT a remote server: this is a LOCAL node process on the user's own machine (and,
// on Android, inside their own phone). It serves the webview to a browser / WebView
// over 127.0.0.1 and nothing leaves the device.
//
// Transport = HTTP-RPC + SSE (the pattern OpenGUI/codex-mobile/anyclaw converged on,
// over a single WebSocket): commands go UI→server as POST /rpc; events go server→UI as
// an SSE stream on GET /events. This is steadier than WS inside an Android WebView
// (no upgrade/firewall issues) and SSE's cursor lets a dropped stream replay missed
// events. The chat dispatcher is unchanged — its ChatTransport.send() feeds the SSE
// writer and ChatTransport.onRecv() is fed by the POST handler, so approvals and every
// other message work exactly as over WS (CODE-RULES: one dispatcher, swap the pipe).
//
// One SSE connection = one chat (one browser tab / one Android WebView). The server
// hands the client an id on connect; the client tags every POST with it, so a POST is
// routed to the matching chat's onRecv. vscode plugs the dispatcher into a panel;
// here it plugs into {SSE writer, POST fan-in} — same shape.
//
// Wallet: unlike vscode/cli (which load a local keypair from disk), the browser
// connects a wallet (Phantom/Solflare/…). So this host boots with NO wallet — the
// runtime is built lazily the first time a client POSTs {connectWallet, address,
// signature} from the onboarding page. One host = one user, so the first connect wins
// and every later client (e.g. the chat page after onboarding) shares that runtime.

import { createServer, type ServerResponse } from "node:http";
import {
  connect,
  createChatSession,
  TransportApprovalChannel,
  webWallet,
  chatHtml,
  onboardingHtml,
  getStorageInfo,
  STORAGE_OPTIONS,
  type AgentRuntime,
  type CloudStatus,
} from "@iqlabs-official/agent-sdk";

const PORT = Number(process.env.AGENTNET_PORT ?? 4317);
// How many recent events to keep per client for SSE replay after a reconnect. A turn
// is well under this; the buffer only needs to cover a brief network drop.
const REPLAY_BUFFER = 256;

// The one runtime for this host, built on first wallet connect. Null until then; once
// set, every client uses it (so the chat page after onboarding finds it ready).
let runtime: AgentRuntime | null = null;
let walletAddress: string | null = null;

// Latest drive-mirror sync result + the hook the active chat sets to surface it
// (cloud writes are otherwise silent). One value; the connected chat reflects it.
let lastCloudStatus: CloudStatus | null = null;
let onCloudStatus: (() => void) | null = null;

// Build the runtime from a freshly connected wallet (idempotent for this host: a
// second connect with the same address is a no-op so re-opened tabs don't rebuild).
async function connectWallet(address: string, signature: Uint8Array): Promise<void> {
  if (runtime && walletAddress === address) return;
  const wallet = webWallet(address, signature);
  runtime = await connect(wallet, (s) => { lastCloudStatus = s; onCloudStatus?.(); });
  walletAddress = address;
}

// ── one connected UI (one SSE stream) ──
// `recv` is the dispatcher/onboarding handler the POST endpoint fans messages into.
// `send` writes an SSE event (numbered for replay); `buffer` holds recent events so a
// reconnect with a cursor can replay what it missed. `res` is the live SSE response.
interface Client {
  res: ServerResponse;
  recv: ((m: any) => void) | null;        // set once chat/onboarding attaches
  seq: number;                            // last event id sent
  buffer: { id: number; data: string }[]; // recent events for replay
  reconnectTimer: ReturnType<typeof setTimeout> | null; // grace before teardown
  teardown: (() => void) | null;          // set by attachChat; tears down the dispatcher
  send(msg: unknown): void;
}

// How long to keep a chat alive after its SSE stream drops, so an auto-reconnect can
// resume it (replay) instead of losing the session.
const RECONNECT_GRACE_MS = 15000;

const clients = new Map<string, Client>();
let clientCounter = 0;

function makeClient(res: ServerResponse): Client {
  const c: Client = {
    res,
    recv: null,
    seq: 0,
    buffer: [],
    reconnectTimer: null,
    teardown: null,
    send(msg) {
      const data = JSON.stringify(msg);
      c.seq += 1;
      c.buffer.push({ id: c.seq, data });
      if (c.buffer.length > REPLAY_BUFFER) c.buffer.shift();
      // Always write to the CURRENT res (rebound on reconnect), not a captured one.
      if (!c.res.writableEnded) c.res.write(`id: ${c.seq}\ndata: ${data}\n\n`);
    },
  };
  return c;
}

// SSE stream dropped → wait out the grace window, then tear down for real if no
// reconnect arrived. A chat client tears down its dispatcher (teardown); an onboarding
// client just leaves the map. A reconnect clears this timer before it fires.
function scheduleTeardown(id: string, c: Client) {
  if (c.reconnectTimer) return;
  c.reconnectTimer = setTimeout(() => {
    if (c.teardown) c.teardown();
    else clients.delete(id);
  }, RECONNECT_GRACE_MS);
}

// Attach the full chat dispatcher to a client (runtime must exist). The dispatcher's
// transport is {send: SSE write, onRecv: register the POST fan-in}. approvalDecision
// arrives via the same onRecv (POST), so TransportApprovalChannel is unchanged.
function attachChat(id: string, c: Client, rt: AgentRuntime) {
  const transport = {
    send: (msg: unknown) => c.send(msg),
    onRecv: (cb: (m: any) => void) => { c.recv = cb; },
  };
  const approval = new TransportApprovalChannel(transport);
  const chat = createChatSession(rt, transport, {
    cwd: () => process.cwd(),
    approval,
    walletAddress: () => walletAddress,
    storageInfo: async () => ({ info: await getStorageInfo(), options: STORAGE_OPTIONS }),
    // Cloud actions (pickCloud / connectCloud / …) rely on native flows this headless
    // host doesn't have yet; their messages no-op (the dispatcher guards each).
  });
  const hook = () => chat.pushCloudStatus(lastCloudStatus);
  onCloudStatus = hook;
  // Teardown is deferred: when the SSE stream closes we don't kill the chat at once —
  // EventSource auto-reconnects, and we want that reconnect to resume the SAME chat
  // (replay), not lose it. The grace timer (set on close, cleared on reconnect) tears
  // down only if the UI really went away.
  c.teardown = () => {
    chat.stop();
    approval.drain();
    clients.delete(id);
    if (onCloudStatus === hook) onCloudStatus = null;
  };
}

// Before a wallet exists, a client is in ONBOARDING: its recv handles only the wallet
// handshake. On connect we build the runtime; the onboarding webview then navigates to
// / (chat), which opens a FRESH SSE client that finds the runtime ready and attaches
// chat. So an onboarding client never carries chat itself — clean separation.
function attachOnboarding(c: Client) {
  c.recv = async (m: any) => {
    if (m?.type === "ready") {
      c.send({ type: "init", defaultPath: null, cloudKind: null });
      return;
    }
    if (m?.type === "connectWallet" && typeof m.address === "string" && Array.isArray(m.signature)) {
      try {
        await connectWallet(m.address, Uint8Array.from(m.signature));
      } catch (e) {
        c.send({ type: "toast", text: "Wallet connect failed: " + (e as Error).message });
        return;
      }
      // Wallet is in → webview navigates to chat (WEB path in onboarding.ts).
      c.send({ type: "walletConnected", address: walletAddress, storageOptions: STORAGE_OPTIONS });
    }
  };
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; if (body.length > 4_000_000) req.destroy(); });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;

  // ── HTML pages ──
  if (req.method === "GET" && (path === "/" || path === "/chat.html")) {
    // No wallet yet → connect one first (server knows runtime state, so the chat page
    // is never reached wallet-less and left hanging).
    if (!runtime) { res.writeHead(302, { location: "/onboarding" }).end(); return; }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(chatHtml());
    return;
  }
  if (req.method === "GET" && path === "/onboarding") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(onboardingHtml());
    return;
  }

  // ── SSE: open this UI's event stream (server→UI). A fresh connection gets a new
  // client id + chat/onboarding attachment. A RECONNECT (?client=<id>&cursor=<seq>,
  // or Last-Event-ID header) rebinds the existing client to the new response and
  // replays events after the cursor — so a brief WebView/network drop loses nothing,
  // without re-running ready or re-attaching the dispatcher. ──
  if (req.method === "GET" && path === "/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const ka = setInterval(() => { if (!res.writableEnded) res.write(": ping\n\n"); }, 15000);

    const prevId = url.searchParams.get("client");
    const existing = prevId ? clients.get(prevId) : undefined;
    if (existing) {
      // Reconnect: cancel the pending teardown, rebind to the new response, replay.
      if (existing.reconnectTimer) { clearTimeout(existing.reconnectTimer); existing.reconnectTimer = null; }
      existing.res = res;
      const cursor = Number(url.searchParams.get("cursor") ?? req.headers["last-event-id"] ?? 0);
      res.write(`event: client\ndata: ${JSON.stringify({ client: prevId })}\n\n`);
      for (const ev of existing.buffer) {
        if (ev.id > cursor) res.write(`id: ${ev.id}\ndata: ${ev.data}\n\n`);
      }
      res.on("close", () => { clearInterval(ka); scheduleTeardown(prevId!, existing); });
      return;
    }

    const id = `c${++clientCounter}`;
    const c = makeClient(res);
    clients.set(id, c);
    // Tell the UI its id (it tags every POST with it) before anything else.
    res.write(`event: client\ndata: ${JSON.stringify({ client: id })}\n\n`);
    res.on("close", () => { clearInterval(ka); scheduleTeardown(id, c); });
    if (runtime) attachChat(id, c, runtime);
    else attachOnboarding(c);
    return;
  }

  // ── RPC: one UI→server command. Routed to its client's recv (the dispatcher or the
  // onboarding handler). The reply is not in the HTTP response — it streams back over
  // that client's SSE (same as WS: send is async/push). ──
  if (req.method === "POST" && path === "/rpc") {
    const id = url.searchParams.get("client") ?? "";
    const c = clients.get(id);
    if (!c || !c.recv) { res.writeHead(409).end("no such client"); return; }
    let msg: unknown;
    try { msg = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end("bad json"); return; }
    // Ack immediately; surface a thrown handler instead of letting it vanish.
    res.writeHead(204).end();
    Promise.resolve(c.recv(msg)).catch((e) => console.error("[rpc] handler error:", e));
    return;
  }

  res.writeHead(404).end("not found");
});

http.listen(PORT, () => {
  console.log(`AgentNet localhost → http://localhost:${PORT}/onboarding  (connect a wallet to begin)`);
});
