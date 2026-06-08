// AgentNet VSCode surface — thin UI over the runtime CONTRACT.
// We import ONLY the contract types; the runtime engine is injected (mock for now,
// real src/runtime later). The webview is the chat; this file is the bridge:
//   webview "send" → handle.send()      (user input → CLI)
//   handle.onMessage → webview "message" (CLI output → panel)

import * as vscode from "vscode";
import type { AgentRuntime, SessionHandle, Wallet } from "../../../src/runtime/contract";
import { createRuntime } from "../../../src/runtime/index";
import { manualStorage } from "../../../src/account/storage/manual";
import { chatHtml } from "./webview";
import nacl from "tweetnacl";

// TEMP wallet — a fixed local keypair stands in for Phantom until wallet-connect
// is wired. signMessage must be deterministic (same key → same session crypto).
// Replaced later by: const { wallet, storage } = await login(phantom).
const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
const wallet: Wallet = {
  address: "TESTWALLET",
  async signMessage(msg) {
    return nacl.sign.detached(msg, kp.secretKey);
  },
};

// Real runtime over local storage (swap manualStorage → login() result for cloud).
const runtime: AgentRuntime = createRuntime(wallet, manualStorage());

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("agentnet.openChat", () => openChat(context))
  );
  // auto-open the chat on activation so testing needs no command
  openChat(context);
}

async function openChat(context: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel(
    "agentnetChat",
    "AgentNet Chat",
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panel.webview.html = chatHtml();

  let handle: SessionHandle | null = null;
  let pendingId: string | undefined; // session to (re)spawn lazily on first send
  let cli: "claude" | "codex" = "claude"; // Platform tab (which CLI)
  let model: string | undefined;          // Model dropdown ("default" → undefined = CLI picks)

  // open = just show history + remember which session. claude is NOT spawned here
  // (spawn costs ~2s); we defer it to the first send so switching sessions is instant.
  async function open(sessionId?: string) {
    handle?.stop();
    handle = null;
    pendingId = sessionId;
    panel.webview.postMessage({ type: "clear" });
    if (sessionId) {
      const history = await runtime.loadSession(sessionId);
      for (const msg of history) panel.webview.postMessage({ type: "message", msg });
    }
  }

  // spawn on demand: first send of an opened session boots claude (resume or new).
  async function ensureHandle() {
    if (handle) return handle;
    handle = await runtime.startSession({ cli, model, cwd: getCwd(), sessionId: pendingId });
    handle.onMessage((msg) => panel.webview.postMessage({ type: "message", msg }));
    handle.onTurnEnd(async () => {
      await pushSessions();
    });
    return handle;
  }

  async function pushSessions() {
    const list = await runtime.listSessions();
    panel.webview.postMessage({ type: "sessions", list, activeId: handle?.sessionId ?? pendingId });
  }

  // webview -> extension
  panel.webview.onDidReceiveMessage(async (m) => {
    switch (m?.type) {
      case "ready": await pushSessions(); await open(); break;            // first load
      case "new":   await open(); await pushSessions(); break;            // + New
      case "open":  await open(m.sessionId); await pushSessions(); break; // resume (instant)
      case "platform":
        // switch CLI; drop the live handle so the next send spawns the new CLI
        if (m.cli === "claude" || m.cli === "codex") { cli = m.cli; handle?.stop(); handle = null; }
        break;
      case "model":
        // "default" = let the CLI pick → undefined (no --model flag)
        model = m.model && m.model !== "default" ? m.model : undefined;
        handle?.stop(); handle = null;
        break;
      case "send":
        if (typeof m.text === "string") (await ensureHandle()).send(m.text);
        break;
      case "delete":
        if (typeof m.sessionId === "string") {
          await runtime.deleteSession(m.sessionId);
          if (m.sessionId === (handle?.sessionId ?? pendingId)) await open(); // cleared active one
          await pushSessions();
        }
        break;
    }
  });

  panel.onDidDispose(() => handle?.stop());
}

function getCwd(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}

export function deactivate() {}
