// AgentNet localhost surface — the HTTP/WebSocket form of vscode's extension host.
// NOT a remote server: this is a LOCAL node process on the user's own machine (and,
// on Android, inside their own phone). It serves the webview to a browser / WebView
// over 127.0.0.1 and nothing leaves the device.
//
// Same core, different pipe: where vscode hands the chat dispatcher a panel
// (postMessage), this hands it a WebSocket. The browser (or an Android WebView)
// loads chatHtml(), which — finding no acquireVsCodeApi — opens a ws://…/chat and
// speaks the identical message protocol. So one dispatcher, one webview, two
// transports (CODE-RULES: no per-platform fork).
//
// Scope (v1): one wallet for this host (the user it runs for), claude + codex via the
// SDKs, local storage always on + optional cloud mirror. Native-only flows (a
// quick-pick to choose a cloud, the onboarding hand-off) aren't wired here yet —
// those env hooks are omitted, so their messages no-op until added.

import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  connect,
  createChatSession,
  TransportApprovalChannel,
  chatHtml,
  onboardingHtml,
  getStorageInfo,
  STORAGE_OPTIONS,
  type CloudStatus,
} from "@iqlabs-official/agent-sdk";
import { localWallet } from "@iqlabs-official/agent-sdk/account/localWallet";

const PORT = Number(process.env.AGENTNET_PORT ?? 4317);

// One wallet for this host (the user it runs for). Loaded once at boot from the
// configured keypair (created at the default path if missing — same as vscode's first
// run). The runtime is rebuilt whenever storage changes, so keep it mutable.
const { wallet } = await localWallet();

// Latest drive-mirror sync result + the hook the active chat sets to surface it
// (cloud writes are otherwise silent). One value; the connected chat reflects it.
let lastCloudStatus: CloudStatus | null = null;
let onCloudStatus: (() => void) | null = null;
let runtime = await connect(wallet, (s) => { lastCloudStatus = s; onCloudStatus?.(); });

// ── HTTP: serve the two webview HTMLs (transport-shimmed to WebSocket) ──
const http = createServer((req, res) => {
  if (req.url === "/" || req.url === "/chat.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(chatHtml());
  } else if (req.url === "/onboarding") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(onboardingHtml());
  } else {
    res.writeHead(404).end("not found");
  }
});

// ── WS: each socket is one chat (one browser tab / one Android WebView) ──
// Mirrors vscode's openChat: a per-socket transport + approval channel, wired to the
// shared runtime. The dispatcher owns all chat state; we only adapt the pipe and
// supply the host env (cwd = where this process runs; cloud actions; storage info).
const wss = new WebSocketServer({ server: http, path: "/chat" });
wss.on("connection", (ws: WebSocket) => {
  const transport = {
    send: (msg: unknown) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); },
    onRecv: (cb: (m: any) => void) => ws.on("message", (raw) => {
      let msg: unknown;
      try { msg = JSON.parse(raw.toString()); } catch { return; } // ignore non-JSON frames
      // cb is the dispatcher's async handler; surface its rejections instead of
      // letting them vanish as unhandled (a thrown handler would otherwise just go
      // silent and the UI would hang waiting for a reply that never comes).
      Promise.resolve(cb(msg)).catch((e) => console.error("[chat] handler error:", e));
    }),
  };

  const approval = new TransportApprovalChannel(transport);

  const chat = createChatSession(runtime, transport, {
    cwd: () => process.cwd(),
    approval,
    walletAddress: () => wallet.address,
    storageInfo: async () => ({ info: await getStorageInfo(), options: STORAGE_OPTIONS }),
    // Cloud actions (pickCloud / connectCloud / disconnectCloud / openCloud) and
    // disconnectWallet are intentionally omitted in v1 — they rely on native flows
    // (pickers, openExternal, an onboarding hand-off) this headless host doesn't have
    // yet. Their messages no-op (the dispatcher guards each with `env.fn?.()`).
  });

  // Reflect drive-mirror sync on this socket while it's the connected chat.
  const hook = () => chat.pushCloudStatus(lastCloudStatus);
  onCloudStatus = hook;

  ws.on("close", () => {
    chat.stop();
    approval.drain();
    if (onCloudStatus === hook) onCloudStatus = null;
  });
});

http.listen(PORT, () => {
  console.log(`AgentNet localhost → http://localhost:${PORT}  (wallet ${wallet.address})`);
});
