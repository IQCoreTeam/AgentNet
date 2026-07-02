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
  listClaudeModelOptions,
  listCodexModelOptions,
  TransportApprovalChannel,
  withTimeout,
  webWallet,
  getStorageInfo,
  STORAGE_OPTIONS,
  detectCli,
  startClaudeLogin,
  markClaudeConnected,
  startCodexLogin,
  markCodexConnected,
  saveCodexApiKey,
  logoutClaude,
  logoutCodex,
  type AgentRuntime,
  type CloudStatus,
  type ClaudeLogin,
  type CodexLogin,
  type Wallet,
  type GoogleLogin,
  type StorageConfig,
  switchStorage,
  disconnectCloud,
  agentnetFolderLink,
  startGoogleLoginFixed,
  saveGoogleCreds,
  hasGoogleCreds,
  isCloudConnected,
  isInitialized,
  marketplaceEnv,
  saveHeliusKey,
  maskedHeliusKey,
  hasDasRpc,
  getNetwork,
  saveGithubToken,
  maskedGithubToken,
  loadGithubToken,
  registerVerifiedWork,
  workflowMintsAmong,
} from "@iqlabs-official/agent-sdk";

const PORT = Number(process.env.AGENTNET_PORT ?? 4317);
const GOOGLE_AUTHORIZE_URL = process.env.GOOGLE_AUTHORIZE_URL || "";

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
let wallet: Wallet | null = null;
let runtime: AgentRuntime | null = null;
let walletAddress: string | null = null;

// Latest drive-mirror sync result + the hook the active chat sets to surface it
// (cloud writes are otherwise silent). One value; the connected chat reflects it.
let lastCloudStatus: CloudStatus | null = null;
let onCloudStatus: (() => void) | null = null;
let googleLoginSession: GoogleLogin | null = null;
let googleLoginError: string | null = null;
let claudeLogin: ClaudeLogin | null = null;
let codexLogin: CodexLogin | null = null;

function googleLoginErrorMessage(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (message.includes("client_secret is missing")) {
    return "Google OAuth client type requires a client secret. Use a no-secret mobile/native OAuth flow; do not put a client secret in the APK.";
  }
  if (message.includes("UNREGISTERED_ON_API_CONSOLE")) {
    return "Google Drive is not registered for this Android build. Add an Android OAuth client in Google Cloud Console for package com.iqlabs.agentnet and this app's signing SHA-1, then try again.";
  }
  return message || "Login was not completed.";
}

async function googleAuthorizeError(res: Response): Promise<string> {
  const text = await res.text();
  if (!text) return `Google Drive authorization failed: ${res.status}`;
  try {
    const data = JSON.parse(text) as { error?: unknown };
    return typeof data.error === "string" ? data.error : text;
  } catch {
    return text;
  }
}

async function connectGoogleDriveStorage() {
  if (!wallet) return;
  await switchStorage(wallet, { kind: "gdrive" });
  runtime = await connect(wallet, (s) => { lastCloudStatus = s; onCloudStatus?.(); });
}

function broadcastGoogleLoginStatus(ok: boolean, error?: string) {
  const payload = {
    type: "googleLoginStatus" as const,
    status: ok ? "done" as const : "error" as const,
    error: ok ? undefined : error ?? "Login was not completed.",
  };
  for (const client of clients.values()) client.send(payload);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function beginGoogleLogin(c: Client) {
  try {
    googleLoginSession?.cancel();
    googleLoginError = null;
    if (GOOGLE_AUTHORIZE_URL) {
      void beginNativeGoogleLogin(c);
      return;
    }
    googleLoginSession = startGoogleLoginFixed(`http://127.0.0.1:${PORT}/oauth/google/callback`);
    c.send({ type: "googleLoginUrl", url: googleLoginSession.url });
    googleLoginSession.done.then(async (ok) => {
      try {
        if (ok) await connectGoogleDriveStorage();
        broadcastGoogleLoginStatus(ok, googleLoginError ?? undefined);
      } catch (e) {
        googleLoginError = googleLoginErrorMessage(e);
        broadcastGoogleLoginStatus(false, googleLoginError);
      } finally {
        googleLoginSession = null;
      }
    });
  } catch (e) {
    c.send({ type: "googleLoginStatus", status: "error", error: (e as Error).message });
    googleLoginSession = null;
  }
}

async function beginNativeGoogleLogin(c: Client) {
  try {
    const res = await fetch(GOOGLE_AUTHORIZE_URL, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(await googleAuthorizeError(res));
    await connectGoogleDriveStorage();
    broadcastGoogleLoginStatus(true);
  } catch (e) {
    googleLoginError = googleLoginErrorMessage(e);
    c.send({ type: "googleLoginStatus", status: "error", error: googleLoginError });
  }
}

async function submitGoogleAuthCode(c: Client, code: string) {
  try {
    await googleLoginSession?.submitCode(code);
  } catch (e) {
    googleLoginError = googleLoginErrorMessage(e);
    c.send({ type: "googleLoginStatus", status: "error", error: googleLoginError });
  }
}

// Build the runtime from a freshly connected wallet (idempotent for this host: a
// second connect with the same address is a no-op so re-opened tabs don't rebuild).
async function connectWallet(address: string, signature: Uint8Array): Promise<void> {
  if (runtime && walletAddress === address) return;
  wallet = webWallet(address, signature, signTransactionViaUi);
  walletAddress = address;
  // Only build the runtime immediately if storage is already configured (returning user).
  // First-time users go through onboarding (storage picker) before runtime is needed;
  // building it here with no-cloud config and then rebuilding after Drive OAuth caused
  // the chat SSE to attach to a stale local runtime while the user was in Chrome.
  if (await isInitialized()) {
    runtime = await connect(wallet, (s) => { lastCloudStatus = s; onCloudStatus?.(); });
  }
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

// On-chain signing must route through the active chat UI, not the onboarding client that
// originally connected the wallet and may already be gone.
let signClient: Client | null = null;
let signCounter = 0;
const pendingSign = new Map<string, { resolve: (signedTx: string) => void; reject: (e: Error) => void }>();

function signTransactionViaUi(txBase64: string): Promise<string> {
  const c = signClient;
  if (!c) return Promise.reject(new Error("No connected wallet UI to sign the transaction."));
  const id = `s${++signCounter}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingSign.delete(id)) reject(new Error("Wallet signing timed out."));
    }, 180_000);
    pendingSign.set(id, {
      resolve: (signedTx) => { clearTimeout(timer); resolve(signedTx); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    c.send({ type: "signTransaction", id, tx: txBase64 });
  });
}

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

async function pushCliStatus(c: Client) {
  const cli = await detectCli();
  c.send({ type: "cliStatus", claude: cli.claude, codex: cli.codex });
}

function attachAuthHandlers(c: Client) {
  c.recvs.push(async (m: any) => {
    switch (m?.type) {
      case "getCliStatus":
        await pushCliStatus(c);
        return;
      case "startClaudeLogin":
        try {
          claudeLogin?.cancel();
          claudeLogin = await startClaudeLogin();
          c.send({ type: "claudeLoginUrl", url: claudeLogin.url });
          claudeLogin.done.then(async (ok) => {
            if (ok) await markClaudeConnected();
            c.send({ type: "claudeLoginStatus", status: ok ? "done" : "error", error: ok ? undefined : "Login was not completed." });
            if (ok) await pushCliStatus(c);
            claudeLogin = null;
          });
        } catch (e) {
          c.send({ type: "claudeLoginStatus", status: "error", error: (e as Error).message });
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
          c.send({ type: "codexLoginChallenge", url: codexLogin.url, code: codexLogin.code });
          codexLogin.done.then(async (ok) => {
            if (ok) await markCodexConnected();
            c.send({ type: "codexLoginStatus", status: ok ? "done" : "error", error: ok ? undefined : "Login was not completed." });
            if (ok) await pushCliStatus(c);
            codexLogin = null;
          });
        } catch (e) {
          c.send({ type: "codexLoginStatus", status: "error", error: (e as Error).message });
          codexLogin = null;
        }
        return;
      case "cancelCodexLogin":
        codexLogin?.cancel();
        codexLogin = null;
        return;
      case "submitCodexApiKey":
        if (typeof m.key !== "string" || !m.key.trim()) return;
        try {
          await saveCodexApiKey(m.key.trim());
          await markCodexConnected();
          c.send({ type: "codexLoginStatus", status: "done" });
          await pushCliStatus(c);
        } catch (e) {
          c.send({ type: "codexLoginStatus", status: "error", error: (e as Error).message });
        }
        return;
      case "logoutEngine": {
        const engine = m.cli === "codex" ? "codex" : "claude";
        try {
          if (engine === "codex") await logoutCodex();
          else await logoutClaude();
          c.send({ type: "toast", text: `${engine === "codex" ? "Codex" : "Claude"} signed out.` });
          await pushCliStatus(c);
        } catch (e) {
          c.send({ type: "toast", text: `Sign-out failed: ${(e as Error).message}` });
        }
        return;
      }
      case "setGoogleCredentials":
        if (typeof m.clientId !== "string") return;
        try {
          await saveGoogleCreds(m.clientId, typeof m.clientSecret === "string" ? m.clientSecret : "");
          c.send({ type: "googleCredsStatus", status: "saved" });
        } catch (e) {
          c.send({ type: "googleCredsStatus", status: "error", error: (e as Error).message });
        }
        return;
      case "startGoogleLogin":
        beginGoogleLogin(c);
        return;
      // One-tap reconnect after a dead cloud sign-in (mirror reports reason:"reauth").
      // Re-runs the same Google flow (native on Android, fixed-redirect on web).
      case "reconnectCloud":
        beginGoogleLogin(c);
        return;
      case "googleAuthCode":
        if (typeof m.code === "string") await submitGoogleAuthCode(c, m.code);
        return;
      case "cancelGoogleLogin":
        googleLoginSession?.cancel();
        googleLoginSession = null;
        return;
    }
  });
}

// Marketplace messages are not part of the agent runtime. They need a connected wallet,
// but they should still work when the active SSE client is in onboarding/storage setup.
function attachMarketHandlers(c: Client) {
  let mktPromise: ReturnType<typeof marketplaceEnv> | null = null;
  // One-time per market session: have we pulled the wallet's owned NFT skills from chain
  // and installed them locally yet? vscode does this at chat "ready" via env.loadOwnedSkills;
  // localhost has no such env wiring, so we drive it from the first owned-skills read below.
  // Reset whenever the market is torn down (wallet / RPC change) so the new wallet re-syncs.
  let ownedSynced = false;
  function withMarketTimeout<T>(task: Promise<T>, message: string) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 8000);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }
  async function getMarket() {
    if (!wallet) throw new Error("Wallet not connected.");
    if (!mktPromise) {
      const currentWallet = wallet;
      mktPromise = withMarketTimeout(
        marketplaceEnv(currentWallet),
        "Marketplace initialization timed out. Add a Helius key in Market RPC settings, then retry.",
      ).catch((e) => {
        mktPromise = null;
        ownedSynced = false;
        throw e;
      });
    }
    return mktPromise;
  }
  // Push the wallet's owned NFT skills to the UI, read straight from CHAIN holdings
  // (ownedSkillCards — the same source the agent profile uses), NOT the local skills dir.
  // This is what makes My Skills show bought NFTs immediately, before/without a local
  // install. `cards` carries the rich cards (name + description) for the grid; names/mints
  // stay for the owned-badges + RegisterWorkRepo, which key off them.
  async function emitOwnedSkills(mkt: Awaited<ReturnType<typeof getMarket>>) {
    const [cards, disposedMints] = await Promise.all([
      mkt.ownedSkillCards().catch(() => []),
      mkt.disposedSkillMints().catch(() => ({})),
    ]);
    const names = cards.map((card) => card.name);
    const mints = Object.fromEntries(cards.map((card) => [card.name, card.id]));
    // Ground-truth which owned mints are workflows (not `card.type`: a mint missing from
    // the indexer catalog falls back to type "skill" even when it's actually a workflow —
    // see ownedSkillCards). The workflow-publish picker needs this to keep owned workflows
    // out of the required-skills checklist (a workflow can't require another workflow).
    const allMints = [...Object.values(mints), ...Object.values(disposedMints)];
    const workflowMints = allMints.length ? await workflowMintsAmong(allMints).catch(() => [] as string[]) : [];
    c.send({ type: "ownedSkills", names, mints, disposedMints, cards, workflowMints });
  }
  // `quiet` = expected transient (no wallet yet): answer reads with empty results and
  // skip every toast, so the market just shows clean empty states until the wallet lands.
  // Real errors (RPC failure, init timeout) pass quiet=false and surface normally.
  function sendMarketError(m: any, error: unknown, quiet = false) {
    const message = error instanceof Error ? error.message : String(error);
    switch (m?.type) {
      case "searchSkills":
        if (quiet) c.send({ type: "searchResults", results: [] });
        else c.send({ type: "searchError", message });
        return;
      case "listAgents":
        c.send({ type: "agents", agents: [] });
        if (!quiet) c.send({ type: "toast", text: "Failed to list agents: " + message });
        return;
      case "getBalance":
        c.send({ type: "balance", lamports: null });
        return;
      case "airdrop":
        c.send({ type: "airdropResult", ok: false, error: message });
        return;
      case "ownedSkills":
        c.send({ type: "ownedSkills", names: [] });
        return;
      case "publishSkill":
        c.send({ type: "publishResult", ok: false, error: message });
        return;
      case "buySkill":
        c.send({ type: "buyResult", skillId: m.skillId ?? "", ok: false, error: message });
        return;
      case "buyAllSkills":
        c.send({ type: "buyAllResult", wallet: m.wallet ?? "", ok: false, bought: 0, failed: 0, error: message });
        return;
      case "buyRequiredSkills":
        c.send({ type: "buyAllResult", wallet: "", ok: false, bought: 0, failed: 0, error: message });
        return;
      case "postNote":
        c.send({ type: "postNoteResult", skillId: m.skillId ?? "", ok: false, error: message });
        return;
      case "postAgentNote":
        c.send({ type: "agentNoteResult", agentWallet: m.agentWallet ?? "", ok: false, error: message });
        return;
      default:
        if (!quiet) c.send({ type: "toast", text: "Marketplace failed: " + message });
    }
  }
  c.recvs.push(async (m: any) => {
    if (!m?.type) return;
    switch (m.type) {
      case "getRpcStatus": {
        const masked = await maskedHeliusKey();
        c.send({ type: "rpcStatus", status: { dasReady: await hasDasRpc(), hasKey: !!masked, masked, network: getNetwork() } });
        return;
      }
      case "submitHeliusKey": {
        if (typeof m.key === "string" && m.key.trim()) {
          await saveHeliusKey(m.key.trim());
          mktPromise = null;
          ownedSynced = false;
          const masked = await maskedHeliusKey();
          c.send({ type: "rpcStatus", status: { dasReady: await hasDasRpc(), hasKey: !!masked, masked, network: getNetwork() } });
          c.send({ type: "toast", text: "Helius key saved." });
        }
        return;
      }
      case "useDefaultRpc": {
        await saveHeliusKey("");
        mktPromise = null;
        ownedSynced = false;
        c.send({ type: "rpcStatus", status: { dasReady: false, hasKey: false, masked: null, network: getNetwork() } });
        return;
      }
    }
    let mkt;
    try {
      mkt = await getMarket();
    } catch (e) {
      // A market message can land in the brief window before the wallet handshake
      // finishes (the handlers are attached to onboarding clients too). That "Wallet not
      // connected." is transient, not a failure — answer with empty results and NO toast.
      const quiet = e instanceof Error && e.message === "Wallet not connected.";
      sendMarketError(m, e, quiet);
      return;
    }
    switch (m.type) {
      case "searchSkills": {
        try {
          const results = await withMarketTimeout(
            mkt.searchSkills(m.query ?? "", m.kind),
            "Skill search timed out. Add a Helius key in Market RPC settings, then retry.",
          );
          c.send({ type: "searchResults", results });
        } catch (e) {
          c.send({ type: "searchError", message: (e as Error).message });
        }
        return;
      }
      case "getSkillDetail": {
        try {
          const detail = await mkt.getSkillDetail(m.mint);
          c.send({ type: "skillDetail", detail });
        } catch (e) {
          c.send({ type: "toast", text: "Failed to load skill: " + (e as Error).message });
        }
        return;
      }
      case "buySkill": {
        try {
          const r = await mkt.buySkill(m.skillId, m.creatorWallet);
          c.send({ type: "buyResult", skillId: m.skillId, ...r });
        } catch (e) {
          c.send({ type: "buyResult", skillId: m.skillId, ok: false, error: (e as Error).message });
        }
        return;
      }
      case "ownedSkills": {
        try {
          // First touch this market session: pull the wallet's owned NFT skills from chain
          // and install them locally, so bought NFTs actually appear on mobile (the names
          // below are read from the LOCAL skills dir, which is empty on a fresh device until
          // this runs). Done in the background — don't block the first paint on a chain
          // round-trip; re-emit the list once the install lands. On failure, allow a retry.
          if (!ownedSynced) {
            ownedSynced = true;
            void mkt.loadOwnedSkills()
              .then(() => emitOwnedSkills(mkt))
              .catch(() => { ownedSynced = false; });
          }
          await emitOwnedSkills(mkt);
        } catch (e) {
          c.send({ type: "toast", text: "Failed to load owned skills: " + (e as Error).message });
        }
        return;
      }
      case "getBalance": {
        try {
          const lamports = await mkt.solBalance();
          c.send({ type: "balance", lamports });
        } catch { c.send({ type: "balance", lamports: null }); }
        return;
      }
      case "airdrop": {
        // Manual "Get devnet SOL" from the fund prompt (mobile/web wallet has no keypair here,
        // but a faucet grant needs no signature). mkt.airdrop already reports its own failures.
        try {
          const r = await mkt.airdrop();
          c.send({ type: "airdropResult", ...r });
        } catch (e) {
          c.send({ type: "airdropResult", ok: false, error: (e as Error).message });
        }
        return;
      }
      case "publishSkill": {
        try {
          const r = await mkt.publishSkill(
            { name: m.name, description: m.description, text: m.text, category: m.category, hashtags: m.hashtags, priceSol: m.priceSol, image: m.image },
            (p) => c.send({ type: "publishProgress", phase: p.phase, signed: p.signed, percent: p.percent, kind: p.kind }),
          );
          c.send({ type: "publishResult", ...r });
        } catch (e) {
          c.send({ type: "publishResult", ok: false, error: (e as Error).message });
        }
        return;
      }
      case "postNote": {
        try {
          const r = await mkt.postNote(m.skillId, m.skillType, m.text, m.gitLink);
          c.send({ type: "postNoteResult", skillId: m.skillId, ...r });
        } catch (e) {
          c.send({ type: "postNoteResult", skillId: m.skillId, ok: false, error: (e as Error).message });
        }
        return;
      }
      case "listAgents": {
        try {
          const r = await withMarketTimeout(
            mkt.listAgents(),
            "Agent list timed out. Add a Helius key in Market RPC settings, then retry.",
          );
          c.send({ type: "agents", agents: r });
        } catch (e) {
          c.send({ type: "agents", agents: [] });
          c.send({ type: "toast", text: "Failed to list agents: " + (e as Error).message });
        }
        return;
      }
      case "getAgentProfile": {
        try {
          const profile = await mkt.getAgentProfile(m.wallet);
          c.send({ type: "agentProfile", profile });
        } catch (e) {
          c.send({ type: "toast", text: "Failed to load agent: " + (e as Error).message });
        }
        return;
      }
      case "buyAllSkills": {
        try {
          const r = await mkt.buyAllSkills(m.wallet);
          c.send({ type: "buyAllResult", wallet: m.wallet, ...r });
        } catch (e) {
          c.send({ type: "buyAllResult", wallet: m.wallet, ok: false, bought: 0, failed: 0, error: (e as Error).message });
        }
        return;
      }
      // Buy a specific set (a workflow's required skills) in one tap — buy each, then
      // refresh owned so the detail's "owned" badges update before the workflow buy.
      case "buyRequiredSkills": {
        let bought = 0, failed = 0;
        for (const item of m.items) {
          try {
            const r = await mkt.buySkill(item.skillId, item.creatorWallet);
            if (r.ok) bought++; else failed++;
          } catch { failed++; }
        }
        c.send({ type: "buyAllResult", wallet: "", ok: failed === 0, bought, failed });
        if (bought > 0) await mkt.loadOwnedSkills().then(() => emitOwnedSkills(mkt)).catch(() => {});
        return;
      }
      case "postAgentNote": {
        try {
          const r = await mkt.postAgentNote(m.agentWallet, m.text, m.gitLink, m.title, m.image);
          c.send({ type: "agentNoteResult", agentWallet: m.agentWallet, ...r });
        } catch (e) {
          c.send({ type: "agentNoteResult", agentWallet: m.agentWallet, ok: false, error: (e as Error).message });
        }
        return;
      }
    }
  });
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
  const approval = withTimeout(new TransportApprovalChannel(transport));
  // claude lister is nullable (probe can fail); reuse its type for both caches so the
  // codex `.catch(() => null)` widening is allowed too.
  type ModelOpts = Awaited<ReturnType<typeof listClaudeModelOptions>>;
  let codexModelOptionsPromise: Promise<ModelOpts> | null = null;
  let claudeModelOptionsPromise: Promise<ModelOpts> | null = null;
  const chat = createChatSession(rt, transport, {
    cwd: () => process.cwd(),
    approval,
    // Live model catalog from the installed CLI (same auth, no extra cost); the picker
    // falls back to the static baseline when the probe returns null. Cached per engine so
    // the subprocess spins up once, not on every picker open.
    modelOptions: async (cli) =>
      cli === "codex"
        ? await (codexModelOptionsPromise ??= listCodexModelOptions().catch(() => null))
        : await (claudeModelOptionsPromise ??= listClaudeModelOptions(process.cwd()).catch(() => null)),
    walletAddress: () => walletAddress,
    storageInfo: async () => ({ info: await getStorageInfo(), options: STORAGE_OPTIONS, googleCredsConfigured: await hasGoogleCreds() }),
    connectCloud: async (cfg) => {
      if (wallet) {
        await switchStorage(wallet, { kind: cfg.kind, location: cfg.location, authHeader: cfg.authHeader } as StorageConfig);
        runtime = await connect(wallet, (s) => { lastCloudStatus = s; onCloudStatus?.(); });
      }
    },
    disconnectCloud: async () => {
      await disconnectCloud();
      if (wallet) {
        runtime = await connect(wallet, (s) => { lastCloudStatus = s; onCloudStatus?.(); });
      }
    },
    disconnectWallet: async () => {
      await disconnectCloud();
      wallet = null;
      walletAddress = null;
      runtime = null;
      c.send({ type: "clear" });
      c.send({ type: "init", defaultPath: null, cloudKind: null, hasWallet: false });
    },
    openCloud: async (kind, location) => {
      if (kind === "gdrive" && walletAddress) {
        const link = await agentnetFolderLink(walletAddress);
        c.send({ type: "openUrl", url: link ?? "https://drive.google.com/drive/my-drive" });
      } else if (kind === "custom" && typeof location === "string") {
        c.send({ type: "openUrl", url: location });
      }
    },
  });
  attachAuthHandlers(c);
  c.recvs.push(async (m: any) => {
    if (m?.type === "ready") await pushCliStatus(c);
  });
  attachMarketHandlers(c);

  signClient = c;
  c.recvs.push((m: any) => {
    if (m?.type !== "signTransactionResult" || typeof m.id !== "string") return;
    const entry = pendingSign.get(m.id);
    if (!entry) return;
    pendingSign.delete(m.id);
    if (typeof m.signedTx === "string") entry.resolve(m.signedTx);
    else entry.reject(new Error(typeof m.error === "string" ? m.error : "Wallet signing was rejected."));
  });

  // ── GitHub token handlers (outside market recv, no wallet required) ──
  c.recvs.push(async (m: any) => {
    if (m?.type === "submitGithubToken" && typeof m.token === "string" && m.token.trim()) {
      await saveGithubToken(m.token.trim());
      const masked = await maskedGithubToken();
      c.send({ type: "githubStatus", hasToken: true, masked: masked ?? undefined });
      c.send({ type: "toast", text: "GitHub token saved." });
      return;
    }
    if (m?.type === "clearGithubToken") {
      await saveGithubToken("");
      c.send({ type: "githubStatus", hasToken: false });
      return;
    }
    if (m?.type === "getGithubStatus") {
      const masked = await maskedGithubToken();
      c.send({ type: "githubStatus", hasToken: !!masked, masked: masked ?? undefined });
      return;
    }
    // Register a repo as verified work: push the public .agentnet marker with the
    // user's GitHub token, then register repo<->skill with the indexer. Token +
    // wallet live here on the host, never in the webview.
    if (m?.type === "registerWorkRepo") {
      const repo = typeof m.repo === "string" ? m.repo : "";
      const skillMints = Array.isArray(m.skillMints) ? m.skillMints.filter((s: unknown) => typeof s === "string") : [];
      try {
        if (!walletAddress) throw new Error("Connect a wallet first.");
        const stored = await loadGithubToken();
        if (!stored?.token) throw new Error("Add a GitHub token first.");
        const { count, repo: full } = await registerVerifiedWork({
          token: stored.token,
          repo,
          skillMints,
          walletAddress,
        });
        c.send({ type: "workRepoRegistered", ok: true, count, repo: full });
      } catch (e) {
        c.send({ type: "workRepoRegistered", ok: false, error: e instanceof Error ? e.message : "Registration failed." });
      }
      return;
    }
  });

  const hook = () => chat.pushCloudStatus(lastCloudStatus);
  onCloudStatus = hook;
  // Teardown is deferred: when the SSE stream closes we don't kill the chat at once —
  // EventSource auto-reconnects, and we want that reconnect to resume the SAME chat
  // (replay), not lose it. The grace timer (set on close, cleared on reconnect) tears
  // down only if the UI really went away.
  c.teardown = () => {
    chat.stop();
    approval.drain?.();
    clients.delete(id);
    if (onCloudStatus === hook) onCloudStatus = null;
    if (signClient === c) signClient = null;
  };
}

// Before a wallet exists, a client is in ONBOARDING: its recv handles the wallet
// handshake plus market RPC/Helius settings (so the storage screen can configure Helius
// before any runtime exists). On connect we build the runtime; the onboarding webview then
// navigates to / (chat), which opens a FRESH SSE client that finds the runtime ready and
// attaches chat. So an onboarding client never carries chat itself — clean separation.
function attachOnboarding(c: Client) {
  attachAuthHandlers(c);
  attachMarketHandlers(c);

  c.recvs.push(async (m: any) => {
    if (m?.type === "ready") {
      c.send({ type: "init", defaultPath: null, cloudKind: null, hasWallet: !!wallet });
      return;
    }
    if (m?.type === "connectWallet" && typeof m.address === "string" && Array.isArray(m.signature)) {
      try {
        await connectWallet(m.address, Uint8Array.from(m.signature));
      } catch (e) {
        c.send({ type: "toast", text: "Wallet connect failed: " + (e as Error).message });
        return;
      }
      // storageConfigured lets the UI skip the storage picker on a returning device —
      // the gdrive choice + token persist, so re-walking that screen (and re-auth) is
      // pointless. Only a true first run needs the picker.
      c.send({ type: "walletConnected", address: walletAddress, storageOptions: STORAGE_OPTIONS, storageConfigured: await isCloudConnected() });
      c.send({ type: "storage", info: await getStorageInfo(), options: STORAGE_OPTIONS, googleCredsConfigured: await hasGoogleCreds() });
      await pushCliStatus(c);
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
    // Wallet is connected this session but the runtime is null — the user finished
    // onboarding and navigated to /chat (a fresh SSE), or a reconnect/reopen raced the
    // deferred build (connectWallet defers it during onboarding to avoid the Chrome-OAuth
    // stale-runtime race). Build it now and bind CHAT instead of falling back to onboarding
    // (which would re-send `init` and silently drop chat messages). We do NOT gate on
    // isInitialized(): local storage ALWAYS works and cloud is optional — connect() mirrors
    // cloud only if one was configured — so a user who chose "continue without cloud" still
    // gets a working chat (matches the desktop/VSCode connect(wallet) path). Only a true
    // process restart (wallet lost from memory) re-onboards.
    else if (wallet) {
      runtime = await connect(wallet, (s) => { lastCloudStatus = s; onCloudStatus?.(); });
      attachChat(id, c, runtime);
    }
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

  // ── OAuth callback: Google redirects here after authorization. Chrome on Android CAN
  // reach this port (same device, proot localhost), unlike a random second port. Extract
  // the code and hand it to the active Google login session, then show a close-tab page.
  if (req.method === "GET" && path === "/oauth/google/callback") {
    const code = url.searchParams.get("code");
    if (code && googleLoginSession) {
      try {
        await googleLoginSession.submitCode(url.toString());
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;background:#111;color:#eee">
          <h2 style="color:#00E673">Google connected</h2><p>You can close this tab and return to AgentNet.</p>
        </body></html>`);
      } catch (e) {
        googleLoginError = googleLoginErrorMessage(e);
        console.error("[oauth] submitCode failed:", e);
        for (const client of clients.values()) {
          client.send({ type: "googleLoginStatus", status: "error", error: googleLoginError });
        }
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;background:#111;color:#eee">
          <h2 style="color:#ff6b6b">Google login failed</h2><p>${escapeHtml(googleLoginError)}</p>
        </body></html>`);
      }
    } else {
      googleLoginError ??= "Google login callback was missing a code.";
      for (const client of clients.values()) {
        client.send({ type: "googleLoginStatus", status: "error", error: googleLoginError });
      }
      res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;background:#111;color:#eee">
        <h2 style="color:#ff6b6b">Google login failed</h2><p>${escapeHtml(googleLoginError)}</p>
      </body></html>`);
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
