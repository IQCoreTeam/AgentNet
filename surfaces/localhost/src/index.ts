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
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname } from "node:path";
import {
  connect,
  createChatSession,
  TransportApprovalChannel,
  webWallet,
  getStorageInfo,
  STORAGE_OPTIONS,
  detectCli,
  startClaudeLogin,
  markClaudeConnected,
  startCodexLogin,
  markCodexConnected,
  saveCodexApiKey,
  type AgentRuntime,
  type CloudStatus,
  type ClaudeLogin,
  type CodexLogin,
} from "@iqlabs-official/agent-sdk";

const PORT = Number(process.env.AGENTNET_PORT ?? 4317);

// The built React UI (surfaces/webview/dist) this host serves. Default is the sibling
// surface relative to this bundle; the Android shell can point elsewhere via env. The
// UI's transport (POST /rpc + SSE /events) is served by this same process.
const WEBVIEW_DIR =
  process.env.AGENTNET_WEBVIEW_DIR ??
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "webview", "dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".png": "image/png",
};

// Serve a file from the webview build. Any path that isn't a real asset falls back to
// index.html — it's a single-page app, so the SPA does its own (wallet → chat) routing.
async function serveWebview(path: string, res: ServerResponse): Promise<void> {
  // Strip the leading slash and normalize away any ../ so a request can't escape the dir.
  const rel = normalize(path).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const isAsset = rel !== "" && extname(rel) !== "";
  const file = join(WEBVIEW_DIR, isAsset ? rel : "index.html");
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    if (isAsset) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(500).end(
      "webview build not found — run `pnpm --filter agentnet-webview build` " +
        "or set AGENTNET_WEBVIEW_DIR",
    );
  }
}
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
  // POST fan-out: every onRecv subscriber. The chat dispatcher AND the approval channel
  // both subscribe (they share one transport), so this MUST be a list — a single slot
  // would let the dispatcher's handler overwrite the approval channel's, and then
  // `approvalDecision` would never resolve the parked tool request (the engine hangs
  // forever waiting on an approval the UI already answered).
  recvs: ((m: any) => void)[];            // set as chat/onboarding/approval attach
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
    recvs: [],
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
    // Subscribe (don't replace): both the dispatcher and the approval channel register a
    // handler on the same transport. POST fans out to all of them.
    onRecv: (cb: (m: any) => void) => { c.recvs.push(cb); },
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
  let claudeLogin: ClaudeLogin | null = null;
  let codexLogin: CodexLogin | null = null;

  c.recvs.push(async (m: any) => {
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
      // Wallet is in. Report CLI auth state so the UI can gate on claude login before
      // chat; if claude is already logged in (or missing), the UI skips straight through.
      const cli = await detectCli();
      c.send({ type: "walletConnected", address: walletAddress, storageOptions: STORAGE_OPTIONS });
      c.send({ type: "cliStatus", claude: cli.claude, codex: cli.codex });
      return;
    }
    // ── claude subscription login: spawn `claude auth login --claudeai`, stream the OAuth
    // URL to the UI, relay the user's pasted code to the CLI's stdin, report the result.
    if (m?.type === "startClaudeLogin") {
      try {
        claudeLogin?.cancel();
        claudeLogin = await startClaudeLogin();
        c.send({ type: "claudeLoginUrl", url: claudeLogin.url });
        claudeLogin.done.then(async (ok) => {
          if (ok) await markClaudeConnected();
          c.send({ type: "claudeLoginStatus", status: ok ? "done" : "error", error: ok ? undefined : "Login was not completed." });
          claudeLogin = null;
        });
      } catch (e) {
        c.send({ type: "claudeLoginStatus", status: "error", error: (e as Error).message });
        claudeLogin = null;
      }
      return;
    }
    if (m?.type === "claudeAuthCode" && typeof m.code === "string") {
      claudeLogin?.submitCode(m.code);
      return;
    }
    if (m?.type === "cancelClaudeLogin") {
      claudeLogin?.cancel();
      claudeLogin = null;
      return;
    }
    // ── codex device-auth: spawn `codex login --device-auth`, parse URL + one-time code,
    // stream both to the UI. CLI auto-polls; no code needs to come back from the UI.
    if (m?.type === "startCodexLogin") {
      try {
        codexLogin?.cancel();
        codexLogin = await startCodexLogin();
        c.send({ type: "codexLoginChallenge", url: codexLogin.url, code: codexLogin.code });
        codexLogin.done.then(async (ok) => {
          if (ok) await markCodexConnected();
          c.send({ type: "codexLoginStatus", status: ok ? "done" : "error", error: ok ? undefined : "Login was not completed." });
          codexLogin = null;
        });
      } catch (e) {
        c.send({ type: "codexLoginStatus", status: "error", error: (e as Error).message });
        codexLogin = null;
      }
      return;
    }
    if (m?.type === "cancelCodexLogin") {
      codexLogin?.cancel();
      codexLogin = null;
      return;
    }
    if (m?.type === "saveCodexApiKey" && typeof m.key === "string" && m.key.trim()) {
      try {
        await saveCodexApiKey(m.key.trim());
        await markCodexConnected();
        c.send({ type: "codexLoginStatus", status: "done" });
      } catch (e) {
        c.send({ type: "codexLoginStatus", status: "error", error: (e as Error).message });
      }
      return;
    }
  });
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
    if (!c || c.recvs.length === 0) { res.writeHead(409).end("no such client"); return; }
    let msg: unknown;
    try { msg = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end("bad json"); return; }
    // Ack immediately; surface a thrown handler instead of letting it vanish.
    res.writeHead(204).end();
    // Fan out to every subscriber (dispatcher + approval channel). A handler that doesn't
    // recognize the message just ignores it (their switches guard each type).
    for (const recv of c.recvs) {
      Promise.resolve(recv(msg)).catch((e) => console.error("[rpc] handler error:", e));
    }
    return;
  }

  // ── static: anything else GET → the webview SPA (assets directly, every other path
  // falls back to index.html so the SPA routes wallet→chat itself). Kept last so /events
  // and /rpc match first. ──
  if (req.method === "GET") {
    await serveWebview(path, res);
    return;
  }

  res.writeHead(404).end("not found");
});

http.listen(PORT, () => {
  console.log(`AgentNet localhost → http://localhost:${PORT}/  (connect a wallet to begin)`);
});
