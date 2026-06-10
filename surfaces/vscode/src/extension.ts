// AgentNet VSCode surface — thin UI over the runtime CONTRACT.
// Flow: boot -> (first run) onboarding [wallet -> optional storage] -> chat.
//   webview "send" -> handle.send()       (user input -> CLI)
//   handle.onMessage -> webview "message" (CLI output -> panel)

import * as vscode from "vscode";
import type { AgentRuntime, SessionHandle, Wallet } from "@iqlabs-official/agent-sdk/runtime/contract";
import {
  connect,
  initialize,
  isCloudConnected,
  currentStorageKind,
  getStorageInfo,
  switchStorage,
  disconnectCloud,
  agentnetFolderLink,
  STORAGE_OPTIONS,
  type StorageConfig,
} from "@iqlabs-official/agent-sdk";
import { localWallet, solanaDefaultKeypairPath } from "@iqlabs-official/agent-sdk/account/localWallet";
import { chatHtml } from "./webview";
import { onboardingHtml } from "./onboarding";
import { WebviewApprovalChannel } from "./approval";

// Built during onboarding (or restored on a configured device), then handed to chat.
// The wallet + runtime are SHARED across all chat panels (one wallet = one session
// store), so every tab sees the same session list. Each panel gets its OWN approval
// channel + slots (created inside openChat) so approvals/handles never cross panels.
let wallet: Wallet | null = null;
let runtime: AgentRuntime | null = null;

// Latest drive-mirror sync result + a hook the chat panel sets so it can show it.
// connect() reports per-write success/failure here (otherwise cloud writes are silent).
let lastCloudStatus: { ok: boolean; error?: string } | null = null;
let onCloudStatusChange: (() => void) | null = null;
function cloudStatusCb(s: { ok: boolean; error?: string }) {
  lastCloudStatus = s;
  onCloudStatusChange?.();
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("agentnet.openChat", () => boot(context)),
    // open ANOTHER chat panel (a new tab). VSCode handles the tab/split/drag; each
    // panel is an independent chat sharing the one wallet+runtime. Needs the runtime
    // ready (onboarded) — otherwise route through boot so onboarding runs first.
    vscode.commands.registerCommand("agentnet.newChat", () => {
      if (runtime) openChat(context, vscode.ViewColumn.Beside);
      else boot(context);
    }),
  );
  boot(context);
}

// Storage model: LOCAL is always on; a CLOUD is an optional mirror you can add now
// or later. So onboarding is shown only on the very first run (a one-time flag),
// NOT based on whether a cloud is configured — local-only is a valid finished state.
async function boot(context: vscode.ExtensionContext) {
  const seen = context.globalState.get<boolean>("onboarded");
  if (seen) {
    wallet = (await localWallet()).wallet;
    runtime = await connect(wallet, cloudStatusCb); // local always works; mirrors cloud if connected
    openChat(context);
  } else {
    openOnboarding(context);
  }
}

function openExternal(url: string) {
  vscode.env.openExternal(vscode.Uri.parse(url));
}

// Onboarding: collect wallet + (optional) storage, build runtime, then swap to chat.
// Storage is OPTIONAL — "maybe later" defaults to local; a cloud can be added later.
function openOnboarding(context: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel(
    "agentnetOnboarding",
    "AgentNet",
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  panel.webview.html = onboardingHtml();

  // Finish onboarding → mark seen, build runtime (local always; cloud if `cfg`), go to chat.
  async function finish(cfg?: StorageConfig) {
    if (cfg) await initialize(cfg, openExternal); // connect a cloud mirror (optional)
    await context.globalState.update("onboarded", true);
    runtime = await connect(wallet!, cloudStatusCb);
    panel.dispose();
    openChat(context);
  }

  panel.webview.onDidReceiveMessage(async (m) => {
    switch (m?.type) {
      case "ready":
        panel.webview.postMessage({
          type: "init",
          defaultPath: solanaDefaultKeypairPath(),
          cloudKind: (await isCloudConnected()) ? await currentStorageKind() : null,
        });
        break;
      case "connectWallet": {
        try {
          const r = await localWallet(m.path); // load AT path; create only if missing
          wallet = r.wallet;
          panel.webview.postMessage({
            type: "walletConnected",
            address: r.address,
            storageOptions: STORAGE_OPTIONS,
          });
        } catch (e) {
          vscode.window.showErrorMessage(
            "Couldn't use that keypair: " + (e instanceof Error ? e.message : String(e)),
          );
        }
        break;
      }
      case "chooseStorage":
        await finish({ kind: m.kind, location: m.location, authHeader: m.authHeader });
        break;
      case "skipStorage":
        await finish(); // local-only (no cloud); add one later from the chat header
        break;
      case "toast":
        if (typeof m.text === "string") vscode.window.showWarningMessage(m.text);
        break;
    }
  });
}

// Which panel currently has each session open (canonical id → panel). Lets us focus
// an existing tab instead of opening the same session twice (which would mean two
// panels appending to one log). Module-global so it spans all panels.
const openSessions = new Map<string, vscode.WebviewPanel>();
// EVERY open chat panel (across all tabs). On wallet disconnect we close them ALL —
// they share one runtime tied to one wallet, so leaving stragglers open would mean
// zombie panels pointing at a now-null runtime (the now-disconnected wallet).
const chatPanels = new Set<vscode.WebviewPanel>();

// Close every chat panel (used when the wallet disconnects — the whole runtime goes
// away, so no panel may keep running against it).
function closeAllChatPanels() {
  for (const p of [...chatPanels]) p.dispose();
}

async function openChat(context: vscode.ExtensionContext, column = vscode.ViewColumn.One) {
  const panel = vscode.window.createWebviewPanel(
    "agentnetChat",
    "AgentNet Chat",
    column,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  chatPanels.add(panel);
  panel.onDidDispose(() => chatPanels.delete(panel));
  // IQ logo as the tab icon (media/iq-logo.svg, shipped with the extension)
  panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "iq-logo.svg");
  panel.webview.html = chatHtml();

  // This panel's OWN approval channel — tool approvals from sessions started here
  // dock in THIS panel, never another tab. Bound for the panel's lifetime.
  const approvalChannel = new WebviewApprovalChannel();
  approvalChannel.bind(panel);
  panel.onDidDispose(() => approvalChannel.bind(null));

  const rt = runtime!; // boot/onboarding guarantee a runtime before chat opens

  // Both CLIs stay "on" at once: each has its OWN slot (handle + which session +
  // model). Switching tabs just repaints the active slot — nothing is killed, so
  // claude and codex never step on each other. A handle is spawned lazily on first
  // send (spawn costs ~2s); codex re-spawns per turn internally anyway.
  type Slot = { handle: SessionHandle | null; pendingId?: string; model?: string };
  const slots: Record<"claude" | "codex", Slot> = {
    claude: { handle: null },
    codex: { handle: null },
  };
  let cli: "claude" | "codex" = "claude"; // which tab is showing
  const slot = () => slots[cli];

  // A handle's output is only painted when ITS cli tab is the active one (so a
  // background reply doesn't bleed into the other tab's log). The message already
  // carries its own .cli (stamped by the runtime), so the webview badges the real
  // engine per-message — correct even for a cross-CLI session.
  function wire(forCli: "claude" | "codex", h: SessionHandle) {
    h.onMessage((msg) => { if (cli === forCli) panel.webview.postMessage({ type: "message", msg }); });
    h.onTurnEnd(async () => {
      if (cli === forCli) panel.webview.postMessage({ type: "turnEnd" }); // stop the typing dots
      await pushSessions();
    });
  }

  // Repaint the log for the current tab from its slot (history of pending session).
  // Each stored message carries its own .cli, so badges reflect the engine that
  // actually produced each turn — not the current tab.
  async function repaint() {
    panel.webview.postMessage({ type: "clear" });
    const id = slot().pendingId;
    if (id) {
      const page = await rt.loadSession(id);
      for (const msg of page.messages) panel.webview.postMessage({ type: "message", msg });
      panel.webview.postMessage({ type: "page", hasMore: page.hasMore, cursor: page.cursor });
    }
  }

  // Open a session into the CURRENT tab's slot — cross-CLI: clicking a session
  // continues that canonical conversation in WHATEVER cli the tab is on (the runtime
  // re-injects its history into that cli on resume). A fresh handle is spawned lazily
  // on the next send.
  //
  // Multi-tab guard: if the session is already open in ANOTHER panel, focus that one
  // instead of opening a duplicate (two panels writing one log races). We track which
  // session THIS panel holds in openSessions so we can hand it back on close.
  let heldSession: string | undefined; // the session id this panel currently owns
  async function open(sessionId?: string) {
    if (sessionId) {
      const other = openSessions.get(sessionId);
      if (other && other !== panel) { other.reveal(); return; } // already open elsewhere
    }
    if (heldSession) openSessions.delete(heldSession);
    slot().handle?.stop();
    slot().handle = null;
    slot().pendingId = sessionId;
    heldSession = sessionId;
    if (sessionId) openSessions.set(sessionId, panel);
    await repaint();
  }
  panel.onDidDispose(() => { if (heldSession) openSessions.delete(heldSession); });

  async function ensureHandle() {
    const s = slot();
    if (s.handle) return s.handle;
    const spawnCli = cli; // capture: cli must not change across the await
    // pass THIS panel's approval channel so its tool approvals dock here.
    s.handle = await rt.startSession({ cli: spawnCli, model: s.model, cwd: getCwd(), sessionId: s.pendingId, approval: approvalChannel });
    wire(spawnCli, s.handle);
    return s.handle;
  }

  async function pushSessions() {
    const list = await rt.listSessions();
    const activeId = slot().handle?.sessionId ?? slot().pendingId;
    panel.webview.postMessage({ type: "sessions", list, activeId });
  }

  // "Storage: iCloud [change]" — local vs cloud state shown in the header.
  async function pushStorage() {
    const info = await getStorageInfo();
    panel.webview.postMessage({ type: "storage", info, options: STORAGE_OPTIONS });
  }

  // Push the latest drive-mirror sync result to the pill (ok / error). Wired to the
  // module-level callback so every cloud write updates the UI.
  function pushCloudStatus() {
    panel.webview.postMessage({ type: "cloudSync", status: lastCloudStatus });
  }
  onCloudStatusChange = pushCloudStatus;

  panel.webview.onDidReceiveMessage(async (m) => {
    switch (m?.type) {
      case "ready": await pushSessions(); await pushStorage(); await open(); break;
      case "new":   await open(); await pushSessions(); break;
      case "newTab": vscode.commands.executeCommand("agentnet.newChat"); break; // open another panel
      // Clicking a session resumes it in the CURRENT tab's cli (cross-CLI). The
      // session's own cli is ignored — that's the whole point of cross-CLI resume.
      case "open":  await open(m.sessionId); await pushSessions(); break;
      case "platform":
        // Switching engine CARRIES the current session over (cross-CLI resume): the
        // session you're working on follows you to the other CLI instead of dropping
        // you on an empty screen. We show a loading flash, hand the session to the new
        // slot, and repaint — the next send resumes it (history re-injected into the
        // new cli). If nothing was open, just switch to a blank chat as before.
        if ((m.cli === "claude" || m.cli === "codex") && m.cli !== cli) {
          const carry = slot().pendingId; // the session the OLD engine was showing
          cli = m.cli;
          if (carry && slot().pendingId !== carry) {
            panel.webview.postMessage({ type: "loading" });
            await open(carry); // resume the same canonical session in the new cli
          } else {
            await repaint();
          }
          await pushSessions();
        }
        break;
      case "model":
        // model is per-slot; changing it only re-spawns THAT slot's handle next send.
        slot().model = m.model && m.model !== "default" ? m.model : undefined;
        slot().handle?.stop(); slot().handle = null;
        break;
      case "send":
        if (typeof m.text === "string") (await ensureHandle()).send(m.text);
        break;
      // user clicked Approve/Deny on a tool-approval card → resolve the pending
      // request so the waiting engine (claude canUseTool) continues.
      case "approvalDecision":
        if (typeof m.id === "string" && m.outcome)
          approvalChannel.resolve(m.id, { outcome: m.outcome, reason: m.reason });
        break;
      // scroll-to-top: fetch the page older than `cursor`, prepend in the webview
      case "loadMore":
        if (slot().pendingId && typeof m.cursor === "number") {
          const page = await rt.loadMore(slot().pendingId!, m.cursor);
          panel.webview.postMessage({
            type: "older",
            messages: page.messages,
            hasMore: page.hasMore,
            cursor: page.cursor,
          });
        }
        break;
      case "delete":
        if (typeof m.sessionId === "string") {
          await rt.deleteSession(m.sessionId);
          // if the deleted one is open in either slot, clear that slot
          for (const k of ["claude", "codex"] as const) {
            const s = slots[k];
            if (m.sessionId === (s.handle?.sessionId ?? s.pendingId)) {
              s.handle?.stop(); s.handle = null; s.pendingId = undefined;
            }
          }
          await repaint();
          await pushSessions();
        }
        break;
      // header "connect" link → native quick-pick of cloud backends, then connect
      case "pickCloud": {
        const cfg = await pickCloud();
        if (!cfg) break; // user dismissed
        try {
          await switchStorage(wallet!, cfg, openExternal);
          runtime = await connect(wallet!, cloudStatusCb);
          await pushStorage();
          await pushSessions();
        } catch (e) {
          // surface the failure instead of silently doing nothing (e.g. missing creds)
          vscode.window.showErrorMessage(
            "Cloud connect failed: " + (e instanceof Error ? e.message : String(e)),
          );
        }
        break;
      }
      // connect / change the cloud mirror (local stays on regardless)
      case "connectCloud": {
        const cfg: StorageConfig = { kind: m.kind, location: m.location, authHeader: m.authHeader };
        await switchStorage(wallet!, cfg, openExternal);
        runtime = await connect(wallet!, cloudStatusCb);
        await pushStorage();
        await pushSessions();
        break;
      }
      // turn the cloud mirror OFF; local sessions stay
      case "disconnectCloud":
        await disconnectCloud();
        runtime = await connect(wallet!, cloudStatusCb);
        await pushStorage();
        await pushSessions();
        break;
      // Clicking the cloud label opens where the sessions actually live. For
      // gdrive we resolve the real "AgentNet" folder link (only the signed-in user
      // can see it) — a direct folder URL, not a search that may not match. Falls
      // back to Drive home if the folder isn't created yet.
      case "openCloud":
        if (m.kind === "gdrive" && wallet) {
          const link = await agentnetFolderLink(wallet.address);
          openExternal(link ?? "https://drive.google.com/drive/my-drive");
        } else if (m.kind === "custom" && typeof m.location === "string") {
          openExternal(m.location);
        }
        break;
      // My Wallet view asks for the address
      case "wallet":
        panel.webview.postMessage({ type: "wallet", address: wallet?.address ?? null });
        break;
      // Disconnect the wallet entirely: drop the cloud, forget onboarding, and go
      // back to the pre-connect (onboarding) screen. Local session files stay on disk.
      // The runtime (tied to this wallet) goes away, so EVERY open chat tab must close —
      // otherwise other tabs become zombies pointing at a null runtime / stale wallet.
      case "disconnectWallet":
        await disconnectCloud();
        await context.globalState.update("onboarded", false);
        wallet = null;
        runtime = null;
        closeAllChatPanels(); // dispose all tabs (each tab's onDidDispose stops its handles)
        openOnboarding(context);
        break;
    }
  });

  panel.onDidDispose(() => {
    slots.claude.handle?.stop(); slots.codex.handle?.stop();
    if (onCloudStatusChange === pushCloudStatus) onCloudStatusChange = null;
  });
}

// Native quick-pick for connecting a cloud from the chat header. Returns a
// StorageConfig (asking for a URL when the backend needs one), or undefined if
// the user dismissed. "local" isn't offered here — local is always on.
async function pickCloud(): Promise<StorageConfig | undefined> {
  const clouds = STORAGE_OPTIONS.filter((o) => o.kind !== "local");
  // NOTE: QuickPickItem reserves `kind` (QuickPickItemKind), so stash our storage
  // kind under a different field (`k`) to avoid the type clash.
  const choice = await vscode.window.showQuickPick(
    clouds.map((o) => ({ label: o.label, detail: o.needs, k: o.kind })),
    { placeHolder: "Connect a cloud to mirror your sessions (local stays on)" }
  );
  if (!choice) return undefined;
  if (choice.k === "custom") {
    const location = await vscode.window.showInputBox({
      prompt: "Endpoint base URL (S3 / WebDAV / HTTP)",
      placeHolder: "https://...",
    });
    if (!location) return undefined;
    const authHeader = await vscode.window.showInputBox({
      prompt: "Authorization header (optional)",
    });
    return { kind: "custom", location, authHeader: authHeader || undefined };
  }
  return { kind: choice.k };
}

function getCwd(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}

export function deactivate() {}
