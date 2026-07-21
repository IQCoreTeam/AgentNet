// AgentNet VSCode surface — thin UI over the runtime CONTRACT.
// Flow: boot -> (first run) onboarding [wallet -> optional storage] -> chat.
//   webview "send" -> handle.send()       (user input -> CLI)
//   handle.onMessage -> webview "message" (CLI output -> panel)

import * as vscode from "vscode";
import * as path from "node:path";
import { homedir } from "node:os";
import type { AgentRuntime, Wallet } from "@iqlabs-official/agent-sdk/runtime/contract";
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
  createChatSession,
  detectCli,
  startClaudeLogin,
  markClaudeConnected,
  startCodexLogin,
  markCodexConnected,
  logoutClaude,
  logoutCodex,
  marketplaceEnv,
  getSkillShopping,
  setSkillShopping,
  saveHeliusKey,
  hasDasRpc,
  maskedHeliusKey,
  getNetwork,
  saveGithubToken,
  loadGithubToken,
  maskedGithubToken,
  registerVerifiedWork,
  TransportApprovalChannel,
  withTimeout,
  chatHtml,
  sidebarHtml,
  onboardingHtml,
  listCodexModelOptions,
  listClaudeModelOptions,
  type ClaudeLogin,
  type CodexLogin,
  type StorageConfig,
} from "@iqlabs-official/agent-sdk";
import { localWallet, solanaDefaultKeypairPath } from "@iqlabs-official/agent-sdk/account/localWallet";
import { NotifyingApprovalChannel } from "./approvalNotify.js";

// Built during onboarding (or restored on a configured device), then handed to chat.
// The wallet + runtime are SHARED across all chat panels (one wallet = one session
// store), so every tab sees the same session list. Each panel gets its OWN approval
// channel + slots (created inside openChat) so approvals/handles never cross panels.
let wallet: Wallet | null = null;
let runtime: AgentRuntime | null = null;

// Latest drive-mirror sync result + a hook the chat panel sets so it can show it.
// connect() reports per-write success/failure here (otherwise cloud writes are silent).
let lastCloudStatus: { ok: boolean; error?: string; reason?: "reauth" | "transient" } | null = null;
let onCloudStatusChange: (() => void) | null = null;
let claudeLogin: ClaudeLogin | null = null;
let codexLogin: CodexLogin | null = null;
function cloudStatusCb(s: { ok: boolean; error?: string; reason?: "reauth" | "transient" }) {
  lastCloudStatus = s;
  onCloudStatusChange?.();
}
// Fire-and-forget one-shot backfill after an explicit (re)connect: push local sessions
// the cloud is missing. Never blocks the reconnect response and never runs on startup, so
// it can't become a per-launch cloud storm; the mirror uploads only what's actually absent.
function backfillCloud(): void {
  void runtime?.syncCloud()
    .then((r) => { if (r.uploaded) console.error(`[cloud] backfilled ${r.uploaded}/${r.missing} missing sessions`); })
    .catch(() => { /* best-effort; a later write or reconnect re-syncs */ });
}

export function activate(context: vscode.ExtensionContext) {
  // Point the runtime at our bundled stdio MCP server (dist/mcp-stdio.js, beside this
  // file) so Codex can load the read-only marketplace tools as a child process. Core
  // reads this path in buildPassiveSpawn; absent → Codex MCP simply stays off.
  process.env.AGENTNET_MCP_STDIO = path.join(__dirname, "mcp-stdio.js");
  context.subscriptions.push(
    vscode.commands.registerCommand("agentnet.openChat", () => boot(context)),
    // open ANOTHER chat panel (a new tab). VSCode handles the tab/split/drag; each
    // panel is an independent chat sharing the one wallet+runtime. Needs the runtime
    // ready (onboarded) — otherwise route through boot so onboarding runs first.
    vscode.commands.registerCommand("agentnet.newChat", () => {
      if (runtime) openChat(context, vscode.ViewColumn.Beside);
      else boot(context);
    }),
    // Activity-bar view: the session-list home (a WebviewView rendered by sidebarHtml).
    // It lists chats with a live per-session RUNNING marker and routes clicks into the
    // chat editor panels. The chat itself stays a full editor panel.
    vscode.window.registerWebviewViewProvider("agentnet.home", {
      resolveWebviewView(view) {
        sidebarView = view;
        view.webview.options = { enableScripts: true };
        view.webview.html = sidebarHtml();
        view.webview.onDidReceiveMessage((m) => void handleSidebarMessage(context, m));
        view.onDidChangeVisibility(() => { if (view.visible) void refreshSidebar(); });
        view.onDidDispose(() => { if (sidebarView === view) sidebarView = undefined; });
      },
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
  void refreshSidebar(); // reflect wallet/session state (or the onboard CTA) in the sidebar
}

function openExternal(url: string) {
  vscode.env.openExternal(vscode.Uri.parse(url));
}

type WebviewTransport = {
  send(msg: unknown): unknown;
  onRecv(cb: (m: any) => void): unknown;
};

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function pushCliStatus(transport: WebviewTransport) {
  const cli = await detectCli();
  transport.send({ type: "cliStatus", claude: cli.claude, codex: cli.codex });
}

function attachAuthHandlers(transport: WebviewTransport) {
  transport.onRecv(async (m: any) => {
    switch (m?.type) {
      case "ready":
      case "getCliStatus":
        await pushCliStatus(transport);
        return;
      case "startClaudeLogin":
        try {
          claudeLogin?.cancel();
          claudeLogin = await startClaudeLogin();
          openExternal(claudeLogin.url);
          transport.send({ type: "claudeLoginUrl", url: claudeLogin.url });
          claudeLogin.done.then(async (ok) => {
            if (ok) await markClaudeConnected();
            transport.send({
              type: "claudeLoginStatus",
              status: ok ? "done" : "error",
              error: ok ? undefined : "Login was not completed.",
            });
            if (ok) await pushCliStatus(transport);
            claudeLogin = null;
          }).catch((e) => {
            transport.send({ type: "claudeLoginStatus", status: "error", error: errorMessage(e) });
            claudeLogin = null;
          });
        } catch (e) {
          transport.send({ type: "claudeLoginStatus", status: "error", error: errorMessage(e) });
          claudeLogin = null;
        }
        return;
      case "claudeAuthCode":
        if (typeof m.code === "string") claudeLogin?.submitCode(m.code);
        return;
      case "cancelClaudeLogin":
        claudeLogin?.cancel();
        claudeLogin = null;
        return;
      case "startCodexLogin":
        try {
          codexLogin?.cancel();
          codexLogin = await startCodexLogin();
          openExternal(codexLogin.url);
          transport.send({ type: "codexLoginChallenge", url: codexLogin.url, code: codexLogin.code });
          codexLogin.done.then(async (ok) => {
            if (ok) await markCodexConnected();
            transport.send({
              type: "codexLoginStatus",
              status: ok ? "done" : "error",
              error: ok ? undefined : "Login was not completed.",
            });
            if (ok) await pushCliStatus(transport);
            codexLogin = null;
          }).catch((e) => {
            transport.send({ type: "codexLoginStatus", status: "error", error: errorMessage(e) });
            codexLogin = null;
          });
        } catch (e) {
          transport.send({ type: "codexLoginStatus", status: "error", error: errorMessage(e) });
          codexLogin = null;
        }
        return;
      case "cancelCodexLogin":
        codexLogin?.cancel();
        codexLogin = null;
        return;
      case "logoutEngine": {
        const engine = m.cli === "codex" ? "codex" : "claude";
        try {
          if (engine === "codex") await logoutCodex();
          else await logoutClaude();
          transport.send({ type: "toast", text: `${engine === "codex" ? "Codex" : "Claude"} signed out.` });
          await pushCliStatus(transport);
        } catch (e) {
          transport.send({ type: "toast", text: `Sign-out failed: ${errorMessage(e)}` });
        }
        return;
      }
    }
  });
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

  // Finish onboarding → save rpc key (if given), mark seen, build runtime (local always;
  // cloud if `cfg`), go to chat. Empty/absent heliusKey keeps the default RPC.
  async function finish(cfg?: StorageConfig, heliusKey?: string) {
    if (heliusKey && heliusKey.trim()) await saveHeliusKey(heliusKey.trim());
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
        await finish({ kind: m.kind, location: m.location, authHeader: m.authHeader }, m.heliusKey);
        break;
      case "skipStorage":
        await finish(undefined, m.heliusKey); // local-only (no cloud); add one later from the chat header
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

// ── Activity-bar sidebar (session-list home) ──────────────────────────────────
// One WebviewView, separate from the chat panels. It mirrors the session list (forwarded
// from whichever chat panel is active, carrying the live `running` set off the core's busy
// set) and routes clicks back into a chat panel. It runs no engine of its own.
let sidebarView: vscode.WebviewView | undefined;
// Each open chat panel's core message-injector, so the sidebar can drive an existing panel
// (switch session / delete) without round-tripping through that panel's webview.
const panelInject = new Map<vscode.WebviewPanel, (m: any) => void>();
// Freshest {type:'sessions'} frame a chat panel forwarded (carries live activeId + running).
// Reused on a sidebar refresh so re-focusing it mid-turn doesn't blank the RUNNING marker.
let lastSessionsFrame: any = null;

function shortAddr(a?: string | null): string | null {
  if (!a) return null;
  return a.length > 10 ? a.slice(0, 4) + "..." + a.slice(-4) : a;
}

function pickChatPanel(): vscode.WebviewPanel | undefined {
  let last: vscode.WebviewPanel | undefined;
  for (const p of chatPanels) last = p; // most-recently opened
  return last;
}

// Reveal (or open) a chat showing `sessionId`: focus the panel already holding it, else
// switch the active panel to it, else open a fresh panel that resumes it once ready.
function revealSession(context: vscode.ExtensionContext, sessionId: string) {
  const holder = openSessions.get(sessionId);
  if (holder) { holder.reveal(); return; }
  const target = pickChatPanel();
  if (target) { target.reveal(); panelInject.get(target)?.({ type: "open", sessionId }); return; }
  void openChat(context, vscode.ViewColumn.One, sessionId);
}

function revealAnyChat(context: vscode.ExtensionContext) {
  const target = pickChatPanel();
  if (target) target.reveal();
  else if (runtime) void openChat(context);
  else void boot(context);
}

// Delete a session from wherever it lives: route through a panel's core (so it tears down
// live handles + repaints + re-pushes the list) when one is open; else delete directly.
async function deleteSessionFromSidebar(sessionId: string) {
  const holder = openSessions.get(sessionId) ?? pickChatPanel();
  const inject = holder && panelInject.get(holder);
  if (inject) { inject({ type: "delete", sessionId }); return; }
  if (runtime) { await runtime.deleteSession(sessionId); await refreshSidebar(); }
}

// Push wallet + storage + session list to the sidebar. Fired on the webview's `ready`, on
// visibility regain, and after wallet connect/disconnect. Live running/active updates while
// a chat is open arrive via the forwarded {type:'sessions'} frames instead of here.
async function refreshSidebar() {
  const v = sidebarView;
  if (!v) return;
  if (!runtime || !wallet) {
    v.webview.postMessage({ type: "onboard", value: true });
    v.webview.postMessage({ type: "wallet", address: null });
    return;
  }
  v.webview.postMessage({ type: "onboard", value: false });
  v.webview.postMessage({ type: "wallet", address: shortAddr(wallet.address) });
  try {
    const connected = await isCloudConnected();
    const kind = connected ? await currentStorageKind() : null;
    const label = STORAGE_OPTIONS.find((o) => o.kind === kind)?.label ?? (kind ? String(kind) : "LOCAL");
    v.webview.postMessage({ type: "storage", connected, label });
  } catch { /* leave the chip at its last state */ }
  // While a chat panel is open its forwarded frame is the live truth (activeId + running);
  // reuse it so re-focusing the sidebar mid-turn keeps the RUNNING marker. Only with no panel
  // open do we read the list fresh (nothing can be running then).
  if (chatPanels.size > 0 && lastSessionsFrame) {
    v.webview.postMessage(lastSessionsFrame);
  } else {
    try {
      const list = await runtime.listSessions();
      v.webview.postMessage({ type: "sessions", list, running: [], cloud: runtime.cloudState?.() ?? "none" });
    } catch { /* keep the last list */ }
  }
}

async function handleSidebarMessage(context: vscode.ExtensionContext, m: any) {
  switch (m?.type) {
    case "ready": await refreshSidebar(); break;
    // New session = a fresh chat in its own tab (never hijacks an open conversation).
    case "new": if (runtime) void vscode.commands.executeCommand("agentnet.newChat"); else void boot(context); break;
    case "open": if (runtime && typeof m.sessionId === "string") revealSession(context, m.sessionId); else void boot(context); break;
    case "delete": if (typeof m.sessionId === "string") await deleteSessionFromSidebar(m.sessionId); break;
    // Wallet menu + storage switching both live in the chat surface for now.
    case "wallet": case "drive": revealAnyChat(context); break;
  }
}

async function openChat(context: vscode.ExtensionContext, column = vscode.ViewColumn.One, initialOpenId?: string) {
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

  // The transport: VSCode's postMessage ⇄ onDidReceiveMessage in the shape the core
  // dispatcher expects. Everything chat-related lives in createChatSession now; this
  // file only adapts VSCode's pipe and supplies the host-specific env callbacks.
  // recvHandlers mirrors every onRecv subscriber so inject() can feed a message straight into
  // them — used by the desktop-popup layer to answer an approval as if the webview had.
  const recvHandlers: ((m: any) => void)[] = [];
  // Deferred session to resume once this panel's core is live: injected after the first
  // {type:'sessions'} frame (which only lands post-`ready`), so opening a specific session
  // in a brand-new panel doesn't race the core's default open().
  let pendingOpenId = initialOpenId;
  // Tap the session list as it flows to the webview so the desktop popup can name the session a
  // request belongs to (sessionId -> title). Kept fresh on every "sessions" push.
  const sessionTitles = new Map<string, string>();
  const transport = {
    send: (msg: unknown) => {
      const m = msg as any;
      if (m && m.type === "sessions" && Array.isArray(m.list)) {
        for (const s of m.list) if (s && s.sessionId) sessionTitles.set(s.sessionId, String(s.title || ""));
        // Mirror the live list (with its `running`/`activeId`) to the sidebar home + cache it.
        lastSessionsFrame = m;
        sidebarView?.webview.postMessage(m);
        if (pendingOpenId) { const id = pendingOpenId; pendingOpenId = undefined; for (const h of recvHandlers) h({ type: "open", sessionId: id }); }
      }
      return panel.webview.postMessage(msg);
    },
    onRecv: (cb: (m: any) => void) => {
      recvHandlers.push(cb);
      return panel.webview.onDidReceiveMessage(cb);
    },
    inject: (m: any) => { for (const h of recvHandlers) h(m); },
  };
  attachAuthHandlers(transport);
  // Expose this panel's core injector so the sidebar can drive it; drop it on dispose.
  panelInject.set(panel, transport.inject);
  panel.onDidDispose(() => panelInject.delete(panel));

  // This panel's OWN approval channel — tool approvals from sessions started here
  // dock in THIS panel (it shares this panel's transport). Drained on dispose so a
  // request to a closed panel auto-denies instead of hanging the engine.
  // Wrap the webview channel so that, when this window is NOT focused, an approval also pops a
  // native macOS dialog (answerable without switching back). The webview card stays the source
  // of truth; whichever surface answers first wins (see approvalNotify.ts).
  const approval = new NotifyingApprovalChannel(
    withTimeout(new TransportApprovalChannel(transport)),
    transport,
    vscode.env.appName,
    (req) => sessionTitles.get(req.sessionId) || undefined,
  );
  panel.onDidDispose(() => approval.drain?.());

  // Multi-tab guard: VSCode can open the same session in two panels (two tabs writing
  // one log races). Claim a session before opening; if another panel holds it, reveal
  // that panel and reject. This panel hands its claim back on close.
  let heldSession: string | undefined;
  function claimSession(sessionId: string | undefined): boolean {
    if (sessionId) {
      const other = openSessions.get(sessionId);
      if (other && other !== panel) { other.reveal(); return false; } // open elsewhere
    }
    if (heldSession) openSessions.delete(heldSession);
    heldSession = sessionId;
    if (sessionId) openSessions.set(sessionId, panel);
    return true;
  }
  panel.onDidDispose(() => { if (heldSession) openSessions.delete(heldSession); });

  // marketplace search/buy/install — needs the wallet + a chain connection. The RPC is
  // resolved inside (registered Helius key wins; else env; else public-devnet default).
  const marketPromise = marketplaceEnv(wallet!);
  const codexModelOptionsPromise = listCodexModelOptions().catch(() => null);
  const claudeModelOptionsPromise = listClaudeModelOptions(getCwd()).catch(() => null);
  const chat = createChatSession(runtime!, transport, {
    cwd: getCwd,
    approval,
    claimSession,
    modelOptions: async (cli) =>
      cli === "codex" ? await codexModelOptionsPromise : await claudeModelOptionsPromise,
    searchSkills: async (query, kind) => (await marketPromise).searchSkills(query, kind),
    getSkillDetail: async (mint) => (await marketPromise).getSkillDetail(mint),
    // local SKILL.md body for the equipped-skill popup (mint-less skills); without this
    // the host returns null and the popup shows "No SKILL.md document found".
    getSkillDoc: async (name) => (await marketPromise).getSkillDoc(name),
    buySkill: async (skillId, creatorWallet) => (await marketPromise).buySkill(skillId, creatorWallet),
    // dispose (un-equip) an owned skill locally + reverse it; without these the webview
    // Remove/Re-equip buttons get "dispose unavailable" from the host.
    disposeSkill: async (skillId) => (await marketPromise).disposeSkill(skillId),
    reEquipSkill: async (skillId) => (await marketPromise).reEquipSkill(skillId),
    disposedSkillMints: async () => (await marketPromise).disposedSkillMints(),
    postNote: async (skillId, skillType, text, gitLink) => (await marketPromise).postNote(skillId, skillType, text, gitLink),
    ownedSkills: async () => (await marketPromise).ownedSkills(),
    ownedNftSkills: async () => (await marketPromise).ownedNftSkills(),
    // slug -> mint for installed NFT skills; lets the panel route bought skills to the
    // on-chain market detail (with comment box). Empty => every click falls to the local
    // doc popup, which is why minted skills couldn't open their on-chain body.
    ownedSkillMints: async () => (await marketPromise).ownedSkillMints(),
    listAgents: async () => (await marketPromise).listAgents(),
    getAgentProfile: async (w) => (await marketPromise).getAgentProfile(w),
    buyAllSkills: async (w) => (await marketPromise).buyAllSkills(w),
    postAgentNote: async (w, t, l, ti, im, p) => (await marketPromise).postAgentNote(w, t, l, ti, im, p),
    solBalance: async () => (await marketPromise).solBalance(),
    publishSkill: async (input, onProgress) => (await marketPromise).publishSkill(input, onProgress),
    loadOwnedSkills: async () => (await marketPromise).loadOwnedSkills(),
    // RPC config (issue #23): capture the Helius key via a native secret input — it
    // never passes through the webview as plain text — then save it like an OAuth token.
    setHeliusKey: async () => {
      const key = await vscode.window.showInputBox({
        title: "Helius API key",
        prompt: "Paste your Helius API key OR the full Helius RPC URL. Stored locally, never synced.",
        password: true,
        ignoreFocusOut: true,
        placeHolder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx  (or https://…helius-rpc.com/?api-key=…)",
      });
      if (key && key.trim()) await saveHeliusKey(key.trim());
    },
    useDefaultRpc: async () => { await saveHeliusKey(""); }, // clear the key
    rpcStatus: async () => {
      const masked = await maskedHeliusKey();
      return { dasReady: await hasDasRpc(), hasKey: !!masked, masked, network: getNetwork() };
    },
    walletAddress: () => wallet?.address ?? null,
    // GitHub verified-work registration (issue #93 parity). Token is stored locally by core
    // (rpc.ts, 0600 file — never through the webview); registerVerifiedWork commits the marker
    // + indexes the repo against the skill mints. Mirrors the localhost surface's handler.
    getGithubStatus: async () => {
      const masked = await maskedGithubToken();
      return { hasToken: !!masked, masked: masked ?? undefined };
    },
    submitGithubToken: async (token: string) => {
      await saveGithubToken(token);
      const masked = await maskedGithubToken();
      return { hasToken: !!masked, masked: masked ?? undefined };
    },
    registerWorkRepo: async (repo: string, skillMints: string[]) => {
      try {
        const stored = await loadGithubToken();
        if (!stored?.token) return { ok: false, error: "Add a GitHub token first." };
        if (!wallet?.address) return { ok: false, error: "Connect a wallet first." };
        const res = await registerVerifiedWork({ token: stored.token, repo, skillMints, walletAddress: wallet.address });
        return { ok: true, count: res.count, repo: res.repo };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Registration failed." };
      }
    },
    storageInfo: async () => ({ info: await getStorageInfo(), options: STORAGE_OPTIONS }),
    // passive skill-shopping toggle (issue #21): persisted in config.json by the SDK.
    getSkillShopping: () => getSkillShopping(),
    setSkillShopping: (on) => setSkillShopping(on),
    // header "connect" link → native quick-pick of cloud backends, then connect
    pickCloud: async () => {
      const cfg = await pickCloud();
      if (!cfg) return; // user dismissed
      try {
        await switchStorage(wallet!, cfg, openExternal);
        runtime = await connect(wallet!, cloudStatusCb);
      } catch (e) {
        // surface the failure instead of silently doing nothing (e.g. missing creds)
        vscode.window.showErrorMessage(
          "Cloud connect failed: " + (e instanceof Error ? e.message : String(e)),
        );
      }
    },
    // connect / change the cloud mirror (local stays on regardless)
    connectCloud: async (c) => {
      await switchStorage(wallet!, { kind: c.kind, location: c.location, authHeader: c.authHeader } as StorageConfig, openExternal);
      runtime = await connect(wallet!, cloudStatusCb);
      backfillCloud(); // one-shot: push local history now that cloud is on
    },
    // Re-run sign-in for the SAME backend after a dead token (invalid_grant). Google
    // requires interactive consent to reissue a refresh token, so the webview's one-tap
    // "reconnect" lands here and re-opens the provider's consent flow.
    reconnectCloud: async (c) => {
      await switchStorage(wallet!, { kind: c.kind || "gdrive" } as StorageConfig, openExternal);
      runtime = await connect(wallet!, cloudStatusCb);
      backfillCloud(); // one-shot: push whatever drifted while the sign-in was dead
    },
    // turn the cloud mirror OFF; local sessions stay
    disconnectCloud: async () => {
      await disconnectCloud();
      runtime = await connect(wallet!, cloudStatusCb);
    },
    // Clicking the cloud label opens where the sessions actually live. For gdrive we
    // resolve the real per-wallet folder link (only the signed-in user can see it) —
    // a direct URL, not a search that may not match. Falls back to Drive home.
    openCloud: async (kind, location) => {
      if (kind === "gdrive" && wallet) {
        const link = await agentnetFolderLink(wallet.address);
        openExternal(link ?? "https://drive.google.com/drive/my-drive");
      } else if (kind === "custom" && typeof location === "string") {
        openExternal(location);
      }
    },
    // Disconnect the wallet entirely: drop the cloud, forget onboarding, go back to
    // onboarding. Local session files stay on disk. The runtime (tied to this wallet)
    // goes away, so EVERY open chat tab must close — otherwise stragglers point at a
    // now-null runtime / stale wallet.
    disconnectWallet: async () => {
      await disconnectCloud();
      await context.globalState.update("onboarded", false);
      wallet = null;
      runtime = null;
      lastSessionsFrame = null; // stale once the wallet/runtime is gone
      closeAllChatPanels();
      openOnboarding(context);
      void refreshSidebar(); // wallet gone → sidebar shows the onboard CTA
    },
  });

  // The "new tab" button is genuinely VSCode-only (it opens another panel). Core has
  // no concept of tabs, so the host handles this message before/around the dispatcher.
  panel.webview.onDidReceiveMessage((m) => {
    if (m?.type === "newTab") vscode.commands.executeCommand("agentnet.newChat");
  });

  // Wire the drive-mirror sync pill: every cloud write reports here; push it to THIS
  // panel. Last writer wins (one active panel reflects status) — matches prior behavior.
  const cloudHook = () => chat.pushCloudStatus(lastCloudStatus);
  onCloudStatusChange = cloudHook;

  panel.onDidDispose(() => {
    chat.stop();
    if (onCloudStatusChange === cloudHook) onCloudStatusChange = null; // only clear OUR hook
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
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspace) return workspace;

  const activeFile = vscode.window.activeTextEditor?.document.uri;
  if (activeFile?.scheme === "file") return path.dirname(activeFile.fsPath);

  const cwd = process.cwd();
  return cwd && cwd !== path.parse(cwd).root ? cwd : homedir();
}

export function deactivate() {}
