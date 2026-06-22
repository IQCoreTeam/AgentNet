// The chat session DISPATCHER — transport-neutral, shared by every surface.
//
// This is the body of what used to live inside vscode's openChat(): the per-panel
// chat state (two engine slots, the open session, pagination) plus the message
// switch that drives the runtime and paints the UI. It speaks to the UI only
// through a `transport` ({send, onRecv}) — VSCode plugs in panel.postMessage, the
// server plugs in a WebSocket, android wraps that server. One dispatcher, every
// surface (CODE-RULES: don't fork this per platform).
//
// What is NOT here: things genuinely specific to a host — opening native pickers,
// reading a workspace cwd, persisting the "onboarded" flag, opening external URLs.
// Those are injected as `env` callbacks so this file stays platform-free.

import type { AgentRuntime, SessionHandle } from "../runtime/contract.js";
import type { ApprovalChannel } from "../runtime/approval/channel.js";
import type { SkillCard, MarketRequest } from "./marketMessages.js";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatModelOption } from "./modelOptions.js";

// The two-way pipe to ONE chat UI (one panel / one socket). Messages both ways are
// flat {type, ...} JSON — the same shape the webview already speaks.
export interface ChatTransport {
  send(msg: unknown): void; // HOST → UI (paint)
  onRecv(cb: (msg: any) => void): void; // UI → HOST (drive)
}

// Host-specific hooks the dispatcher can't do itself. Chat-pure messages (send,
// open, model, platform, delete, loadMore, approval) need none of these; only the
// wallet/cloud actions — which touch native pickers, persisted flags, or URLs — do.
export interface ChatEnv {
  cwd(): string; // where to spawn the engine (vscode: workspace; server: project root)
  // where THIS chat's tool approvals are decided. The approval channel owns its own
  // UI round-trip (it subscribes to the transport for "approvalDecision"), so the
  // dispatcher just hands it to startSession and never sees approval messages.
  approval: ApprovalChannel;
  // wallet/cloud actions delegated to the host (native UI / persistence). Each is
  // async; the dispatcher just calls and repaints after. Omit any the host doesn't
  // offer (e.g. a headless server may not support pickCloud) — its message no-ops.
  pickCloud?(): Promise<void>;
  connectCloud?(cfg: { kind: string; location?: string; authHeader?: string }): Promise<void>;
  disconnectCloud?(): Promise<void>;
  disconnectWallet?(): Promise<void>;
  openCloud?(kind: string, location?: string): Promise<void>;
  walletAddress(): string | null; // for the "My Wallet" view
  storageInfo(): Promise<{ info: unknown; options: unknown }>; // header storage pill
  // marketplace (issue #17): search + buy need the wallet + a chain connection, which
  // are host-held (the extension owns them), so they're delegated like wallet/cloud.
  // buySkill installs the bought skill's SKILL.md into the runtime skills dir as part
  // of the buy (the host calls SkillSync.installBought), returning the installed slug.
  searchSkills?(query: string, kind?: "skill" | "workflow"): Promise<SkillCard[]>;
  getSkillDetail?(mint: string): Promise<import("./marketMessages.js").SkillDetail>;
  getSkillDoc?(name: string): Promise<string | null>;
  buySkill?(skillId: string, creatorWallet?: string): Promise<{ ok: boolean; slug?: string; error?: string }>;
  // dispose (un-equip) an owned skill: local + sticky (soulbound NFT stays owned, no refund).
  disposeSkill?(skillId: string): Promise<{ ok: boolean; slug?: string; error?: string }>;
  // re-equip a previously-disposed skill the wallet still owns (undo, no re-buy).
  reEquipSkill?(skillId: string): Promise<{ ok: boolean; slug?: string; error?: string }>;
  // slug -> mint for disposed (un-pinned) skills — the UI greys these + offers Re-equip.
  disposedSkillMints?(): Promise<Record<string, string>>;
  // issue #34: post a comment on a skill (holder-gated), returns refreshed notes on success
  postNote?(skillId: string, skillType: "skill" | "workflow" | undefined, text: string, gitLink?: string): Promise<{ ok: boolean; notes?: import("./marketMessages.js").Note[]; error?: string }>;
  ownedSkills?(): Promise<string[]>; // skill names already installed (panel fill)
  // The wallet's soulbound NFT skills, by display name (catalog ∩ holdings). This is
  // what the "Equipped skills" panel shows: skills you OWN on-chain, not local dirs.
  // Preferred over ownedSkills() for the panel; falls back to it when not provided.
  ownedNftSkills?(): Promise<string[]>;
  // slug -> mint for installed NFT skills; lets the panel reuse getSkillDetail(mint).
  ownedSkillMints?(): Promise<Record<string, string>>;
  // issue #35: agent directory + profile
  listAgents?(): Promise<import("./marketMessages.js").Reputation[]>;
  getAgentProfile?(wallet: string): Promise<import("./marketMessages.js").AgentProfile>;
  buyAllSkills?(wallet: string): Promise<{ ok: boolean; bought: number; failed: number; error?: string }>;
  postAgentNote?(agentWallet: string, text: string, gitLink?: string): Promise<{ ok: boolean; notes?: import("./marketMessages.js").Note[]; error?: string }>;
  solBalance?(): Promise<number | null>; // wallet's native SOL balance (lamports), for the UI funds display
  // make-skill: publish a new skill from the UI. priceSol is the human SOL string; the
  // host converts to lamports and calls core publishSkill. Returns the new mint on success.
  publishSkill?(input: {
    name: string;
    description: string;
    text: string;
    category?: string;
    hashtags?: string[];
    priceSol: string;
    image?: string;
  }): Promise<{ ok: boolean; mint?: string; error?: string }>;
  // install every owned skill NFT into the runtime skills dir (session start + after a
  // buy), so the agent always has its owned skills present + discoverable. Returns slugs.
  loadOwnedSkills?(): Promise<string[]>;
  // passive skill-shopping toggle (issue #21): ON = agent shops for missing capabilities
  // (verify → confirm → buy); OFF = owned-only, never buys. Persisted in config.json by
  // the host (login.ts getSkillShopping/setSkillShopping). Default ON.
  getSkillShopping?(): Promise<boolean>;
  setSkillShopping?(on: boolean): Promise<void>;
  // RPC config (issue #23). setHeliusKey opens a host-native secret input (the key
  // never goes through the UI as plain text); the others persist/read the choice.
  setHeliusKey?(): Promise<void>;
  useDefaultRpc?(): Promise<void>;
  rpcStatus?(): Promise<import("./marketMessages.js").RpcStatus>;
  // Optional model catalog override from the host. VSCode uses this for Codex so the
  // picker can show the actual models exposed by the logged-in app-server account.
  modelOptions?(cli: "claude" | "codex"): Promise<ChatModelOption[] | null>;
  // OPTIONAL multi-tab guard: vscode can open the same session in two panels (two
  // tabs writing one log races), so it claims a session before opening and yields
  // false to abort if another panel already holds it. One-socket surfaces (server,
  // android) omit this — there's only ever one view per chat. Called with the id
  // being opened (undefined = a fresh/blank chat, always allowed).
  claimSession?(sessionId: string | undefined): boolean;
}

// Names for the "Equipped skills" panel: prefer on-chain owned NFT skills; fall back
// to locally-installed skill dirs only when the host doesn't expose the NFT view.
async function ownedNames(env: ChatEnv): Promise<string[]> {
  if (env.ownedNftSkills) return env.ownedNftSkills();
  if (env.ownedSkills) return env.ownedSkills();
  return [];
}

// Full "ownedSkills" message: names for the panel + slug->mint so a bought skill's
// card can reuse the market's on-chain getSkillDetail(mint) instead of a local file.
async function ownedSkillsMsg(env: ChatEnv): Promise<{ type: "ownedSkills"; names: string[]; mints?: Record<string, string>; disposedMints?: Record<string, string> }> {
  const names = await ownedNames(env);
  const mints = env.ownedSkillMints ? await env.ownedSkillMints().catch(() => ({})) : {};
  const disposedMints = env.disposedSkillMints ? await env.disposedSkillMints().catch(() => ({})) : {};
  return { type: "ownedSkills", names, mints, disposedMints };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function initInstructionsFile(cli: "claude" | "codex", cwd: string): Promise<{ file: string; created: boolean }> {
  const file = cli === "codex" ? "AGENTS.md" : "CLAUDE.md";
  const path = join(cwd, file);
  if (await exists(path)) return { file, created: false };
  const tool = cli === "codex" ? "Codex" : "Claude Code";
  await writeFile(path, [
    `# ${file}`,
    "",
    `Project instructions for ${tool}.`,
    "",
    "- Follow the existing repository conventions.",
    "- Keep changes focused on the user's request.",
    "- Run the relevant checks before handing off changes.",
    "",
  ].join("\n"), "utf8");
  return { file, created: true };
}

// Wire one chat UI to the runtime. Returns a stop() that tears down both engine
// slots — the host calls it on panel/socket close.
export function createChatSession(
  rt: AgentRuntime,
  transport: ChatTransport,
  env: ChatEnv,
): { stop: () => void; pushCloudStatus: (s: { ok: boolean; error?: string } | null) => void } {
  // Both CLIs stay "on" at once: each has its OWN slot (handle + which session +
  // model). Switching tabs just repaints the active slot — nothing is killed, so
  // claude and codex never step on each other. A handle is spawned lazily on first
  // send (spawn costs ~2s); codex re-spawns per turn internally anyway.
  // `restage` = a config (model/mode) changed while a handle was live. We DON'T tear
  // the handle down on the toggle — that would interrupt an in-flight turn (claude
  // q.interrupt / codex child.kill). Instead we re-spawn lazily on the next send,
  // carrying the live session over, so the running turn finishes untouched and the new
  // setting applies from the next message.
  type Slot = { handle: SessionHandle | null; pendingId?: string; model?: string; mode?: string; effort?: "low" | "medium" | "high" | "xhigh" | "max"; restage?: boolean; lastUsage?: number };
  const slots: Record<"claude" | "codex", Slot> = {
    claude: { handle: null, mode: "acceptEdits" },
    codex: { handle: null, mode: "auto" },
  };
  let cli: "claude" | "codex" = "claude"; // which tab is showing
  const slot = () => slots[cli];

  // typed host->UI marketplace push: the contract (marketMessages.ts) is enforced
  // here, so a wrong field/type on a market event is a compile error, not a silent
  // runtime miss. Every surface's UI reads the same shape.
  const sendMarket = (e: import("./marketMessages.js").MarketEvent) => transport.send(e);

  // A handle's output is only painted when ITS cli tab is the active one (so a
  // background reply doesn't bleed into the other tab's log). The message already
  // carries its own .cli (stamped by the runtime), so the UI badges the real engine
  // per-message — correct even for a cross-CLI session.
  function wire(forCli: "claude" | "codex", h: SessionHandle) {
    h.onMessage((msg) => { if (cli === forCli) transport.send({ type: "message", msg }); });
    // a skill firing → the green "Casting <skill>" marquee (issue #17). Transient, not
    // persisted; only painted for the active tab.
    h.onSkill((name) => { if (cli === forCli) sendMarket({ type: "skillActive", name }); });
    // token usage: forward to the active surface so it can render a context meter.
    h.onUsage((contextTokens) => {
      slots[forCli].lastUsage = contextTokens;
      if (cli === forCli) transport.send({ type: "usage", contextTokens });
    });
    h.onTurnEnd(async () => {
      if (cli === forCli) transport.send({ type: "turnEnd" }); // stop the typing dots
      await pushSessions();
    });
  }

  // Repaint the log for the current tab from its slot (history of pending session).
  // Each stored message carries its own .cli, so badges reflect the engine that
  // actually produced each turn — not the current tab.
  async function repaint() {
    transport.send({ type: "clear" });
    const id = slot().pendingId;
    if (id) {
      // Show the loading state while we read the session from storage (can be slow on
      // mobile/cloud). Without this the UI just cleared to an empty "start a chat" screen
      // until messages arrived, which read as "nothing happened". `page` clears it.
      transport.send({ type: "loading" });
      const page = await rt.loadSession(id);
      for (const msg of page.messages) transport.send({ type: "message", msg });
      transport.send({ type: "page", hasMore: page.hasMore, cursor: page.cursor });
    }
  }

  // Open a session into the CURRENT tab's slot — cross-CLI: opening a session
  // continues that canonical conversation in WHATEVER cli the tab is on (the runtime
  // re-injects its history into that cli on resume). A fresh handle is spawned lazily
  // on the next send. Returns false if the host's multi-tab guard rejected the open
  // (the session is live in another panel) — the caller skips the follow-up paint.
  async function open(sessionId?: string): Promise<boolean> {
    if (env.claimSession && !env.claimSession(sessionId)) return false;
    slot().handle?.stop();
    slot().handle = null;
    slot().restage = false; // fresh slot — no pending config re-spawn to carry over
    slot().pendingId = sessionId;
    await repaint();
    return true;
  }

  async function ensureHandle() {
    const s = slot();
    if (s.handle && !s.restage) return s.handle;
    // A model/mode change since the last spawn: retire the old handle HERE (turn is
    // idle — we're about to send), carrying its live sessionId into pendingId so the
    // re-spawn RESUMES the same canonical session instead of starting a blank one.
    if (s.handle && s.restage) {
      s.pendingId = s.handle.sessionId || s.pendingId;
      s.handle.stop();
      s.handle = null;
      s.restage = false;
    }
    const spawnCli = cli; // capture: cli must not change across the await
    s.handle = await rt.startSession({ cli: spawnCli, model: s.model, mode: s.mode, effort: s.effort, cwd: env.cwd(), sessionId: s.pendingId, approval: env.approval });
    wire(spawnCli, s.handle);
    return s.handle;
  }

  async function pushSessions() {
    const list = await rt.listSessions();
    const activeId = slot().handle?.sessionId ?? slot().pendingId;
    transport.send({ type: "sessions", list, activeId });
  }

  async function pushStorage() {
    const { info, options } = await env.storageInfo();
    transport.send({ type: "storage", info, options });
  }

  async function pushSkillShopping() {
    // default ON when the host doesn't offer the toggle (matches login.ts default).
    const on = env.getSkillShopping ? await env.getSkillShopping() : true;
    transport.send({ type: "skillShopping", on });
  }

  async function pushModelOptions(forCli: "claude" | "codex") {
    if (!env.modelOptions) return;
    const options = await env.modelOptions(forCli).catch(() => null);
    if (options?.length) transport.send({ type: "modelOptions", cli: forCli, options });
  }

  // Process messages STRICTLY in order — each handler runs to completion before the
  // next starts. Without this, two async handlers race: e.g. "ready" (which awaits
  // open()) and a fast "send" overlap, and ready's open() stops the handle send just
  // created → an empty turn. A surface may fire ready+send back-to-back (reconnect,
  // automation), so the dispatcher owns the ordering rather than trusting arrival gaps.
  const queue: any[] = [];
  let pumping = false;
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length) await handle(queue.shift());
    } finally {
      pumping = false;
    }
  }
  transport.onRecv((m) => { queue.push(m); void pump(); });

  async function handle(m: any) {
    switch (m?.type) {
      case "ready":
        await pushSessions(); await pushStorage(); await pushSkillShopping(); await open();
        void pushModelOptions("codex");
        // install the wallet's owned skills so they're present + discoverable this
        // session (issue #17). Fire-and-forget: a chain hiccup must not delay the chat;
        // refresh the panel once it lands.
        void (async () => {
          await env.loadOwnedSkills?.();
          sendMarket(await ownedSkillsMsg(env));
        })().catch(() => {});
        break;
      case "new":   await open(); await pushSessions(); break;
      case "clear":
        // Reset context, not only the transcript DOM. This intentionally opens a blank
        // in-place chat for the active engine; `/new` remains the explicit fresh-session
        // action users can pick from the UI.
        await open();
        await pushSessions();
        break;
      // Opening a session resumes it in the CURRENT tab's cli (cross-CLI). The
      // session's own cli is ignored — that's the whole point of cross-CLI resume.
      // If the guard rejected it (open elsewhere), don't repaint the session list.
      case "open":  if (await open(m.sessionId)) await pushSessions(); break;
      case "platform":
        // Switching engine CARRIES the current session over (cross-CLI resume): the
        // session you're working on follows you to the other CLI instead of dropping
        // you on an empty screen. We show a loading flash, hand the session to the new
        // slot, and repaint — the next send resumes it (history re-injected into the
        // new cli). If nothing was open, just switch to a blank chat as before.
        if ((m.cli === "claude" || m.cli === "codex") && m.cli !== cli) {
          const carry = slot().pendingId; // the session the OLD engine was showing
          cli = m.cli;
          void pushModelOptions(cli);
          if (carry && slot().pendingId !== carry) {
            transport.send({ type: "loading" });
            await open(carry); // resume the same canonical session in the new cli
          } else {
            await repaint();
          }
          await pushSessions();
        }
        break;
      case "model":
        // model is per-slot. Don't kill a live handle (that would abort an in-flight
        // turn) — flag for a lazy re-spawn on the next send. If no handle exists yet,
        // the next spawn already picks up the new value, so no restage is needed.
        slot().model = m.model && m.model !== "default" ? m.model : undefined;
        if (slot().handle) slot().restage = true;
        break;
      case "mode":
        // permission mode is per-slot. Unlike model, the value is always meaningful
        // (claude "default"/codex "auto" are real modes), so we keep it as-is and let
        // an undefined fall back to the engine default in spawn. Same lazy-restage rule
        // as model: NEVER stop the running handle here — toggling the mode picker must
        // not interrupt the turn the user is watching. The new permissionMode/sandbox
        // takes effect from the next message.
        if (typeof m.mode === "string") {
          slot().mode = m.mode;
          const h = slot().handle;
          if (h) {
            h.updateMode?.(m.mode);
            slot().restage = true;
          }
        }
        break;
      case "effort": {
        // reasoning effort is per-slot. Same lazy-restage rule as model/mode: never kill
        // a live turn — the new effort takes effect from the next spawned handle.
        const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
        const e = EFFORTS.find((v) => v === m.effort);
        slot().effort = e;
        if (slot().handle) slot().restage = true;
        break;
      }
      case "send": {
        // images are optional; an image-only turn (empty text) is allowed. Each is
        // { mime, dataBase64, name? } — the engine layer renders/attaches per its CLI.
        const imgs = Array.isArray(m.images) && m.images.length ? m.images : undefined;
        if (typeof m.text === "string" && (m.text.length > 0 || imgs)) {
          (await ensureHandle()).send(m.text, imgs);
        }
        break;
      }
      case "slashCommand": {
        const command = typeof m.command === "string" ? m.command : "";
        const arg = typeof m.arg === "string" ? m.arg.trim() : "";
        if (command === "permissions") {
          const modes = cli === "claude"
            ? "default, acceptEdits, plan, bypassPermissions"
            : "readonly, auto, full";
          transport.send({ type: "notice", text: `Current permission mode: ${slot().mode ?? "default"}\nAvailable modes: ${modes}\nUse /permissions <mode> or /mode <mode> to change it.` });
          break;
        }
        if (command === "init") {
          try {
            const res = await initInstructionsFile(cli, env.cwd());
            transport.send({ type: "notice", text: res.created ? `Created ${res.file}.` : `${res.file} already exists.` });
          } catch (e) {
            transport.send({ type: "notice", text: `Could not create instructions file: ${e instanceof Error ? e.message : String(e)}` });
          }
          break;
        }
        if (command === "skills") {
          sendMarket(await ownedSkillsMsg(env));
          transport.send({ type: "notice", text: "Skills refreshed." });
          break;
        }
        if (command === "compact") {
          const h = await ensureHandle();
          h.runSlashCommand?.("compact", arg || undefined);
          break;
        }
        if (command === "diff") {
          const h = await ensureHandle();
          h.runSlashCommand?.("diff");
          break;
        }
        if (command === "review" || command === "mcp") {
          const h = await ensureHandle();
          h.runSlashCommand?.(command, arg || undefined);
          break;
        }
        if (command === "status" || command === "cost" || command === "usage") {
          const s = slot();
          transport.send({
            type: "status",
            status: {
              cli,
              sessionId: s.handle?.sessionId ?? s.pendingId,
              model: s.model ?? "default",
              mode: s.mode,
              effort: s.effort ?? "default",
              contextTokens: s.lastUsage,
            },
          });
          break;
        }
        if (command === "resume") {
          await pushSessions();
          transport.send({ type: "notice", text: "Resume: open a session from History." });
          break;
        }
        if (command) {
          const h = await ensureHandle();
          h.runSlashCommand?.(command, arg || undefined);
        }
        break;
      }
      case "interrupt":
        // stop the in-flight turn but keep the session — no re-spawn, no history loss.
        slot().handle?.interrupt();
        break;
      // NOTE: "approvalDecision" is owned by the approval channel (it subscribes to
      // the transport itself), so there's deliberately no case for it here.
      // scroll-to-top: fetch the page older than `cursor`, prepend in the UI
      case "loadMore":
        if (slot().pendingId && typeof m.cursor === "number") {
          const page = await rt.loadMore(slot().pendingId!, m.cursor);
          transport.send({ type: "older", messages: page.messages, hasMore: page.hasMore, cursor: page.cursor });
        }
        break;
      case "delete":
        if (typeof m.sessionId === "string") {
          await rt.deleteSession(m.sessionId);
          // if the deleted one is open in either slot, clear that slot
          for (const k of ["claude", "codex"] as const) {
            const s = slots[k];
            if (m.sessionId === (s.handle?.sessionId ?? s.pendingId)) {
              s.handle?.stop(); s.handle = null; s.pendingId = undefined; s.restage = false;
            }
          }
          await repaint();
          await pushSessions();
        }
        break;
      // ── wallet/cloud: delegated to the host (native UI / persistence) ──
      case "pickCloud":       await env.pickCloud?.(); await pushStorage(); await pushSessions(); break;
      case "connectCloud":    await env.connectCloud?.({ kind: m.kind, location: m.location, authHeader: m.authHeader }); await pushStorage(); await pushSessions(); break;
      case "disconnectCloud": await env.disconnectCloud?.(); await pushStorage(); await pushSessions(); break;
      case "disconnectWallet": await env.disconnectWallet?.(); break;
      case "openCloud":       await env.openCloud?.(m.kind, m.location); break;
      case "wallet":          transport.send({ type: "wallet", address: env.walletAddress() }); break;
      // ── marketplace: search → buy → install (delegated to the host) ──
      // payload typed via the shared contract (marketMessages.ts) so a wrong field
      // is caught here, not at runtime on some surface.
      case "searchSkills": {
        const req = m as Extract<MarketRequest, { type: "searchSkills" }>;
        try {
          const results = env.searchSkills ? await env.searchSkills(req.query ?? "", req.kind) : [];
          sendMarket({ type: "searchResults", results });
        } catch (e) {
          // a chain/RPC failure must NOT leave the UI stuck on "Searching…": surface it.
          sendMarket({ type: "searchError", message: e instanceof Error ? e.message : String(e) });
        }
        break;
      }
      case "getSkillDetail": {
        const req = m as Extract<MarketRequest, { type: "getSkillDetail" }>;
        try {
          if (env.getSkillDetail) sendMarket({ type: "skillDetail", detail: await env.getSkillDetail(req.mint) });
        } catch (e) {
          sendMarket({ type: "searchError", message: e instanceof Error ? e.message : String(e) });
        }
        break;
      }
      case "getSkillDoc": {
        const req = m as Extract<MarketRequest, { type: "getSkillDoc" }>;
        try {
          const text = env.getSkillDoc ? await env.getSkillDoc(req.name) : null;
          sendMarket({ type: "skillDoc", name: req.name, text });
        } catch {
          sendMarket({ type: "skillDoc", name: req.name, text: null });
        }
        break;
      }
      case "buySkill": {
        const req = m as Extract<MarketRequest, { type: "buySkill" }>;
        const res = env.buySkill ? await env.buySkill(req.skillId, req.creatorWallet) : { ok: false, error: "buy unavailable" };
        sendMarket({ type: "buyResult", skillId: req.skillId, ...res });
        if (res.ok) {
          await env.loadOwnedSkills?.(); // re-sync the whole owned set after the buy
          sendMarket(await ownedSkillsMsg(env));
        }
        break;
      }
      case "disposeSkill": {
        const req = m as Extract<MarketRequest, { type: "disposeSkill" }>;
        const res = env.disposeSkill ? await env.disposeSkill(req.skillId) : { ok: false, error: "dispose unavailable" };
        sendMarket({ type: "disposeResult", skillId: req.skillId, ...res });
        if (res.ok) sendMarket(await ownedSkillsMsg(env)); // re-sync so the panel drops it
        break;
      }
      case "reEquipSkill": {
        const req = m as Extract<MarketRequest, { type: "reEquipSkill" }>;
        const res = env.reEquipSkill ? await env.reEquipSkill(req.skillId) : { ok: false, error: "re-equip unavailable" };
        sendMarket({ type: "reEquipResult", skillId: req.skillId, ...res });
        if (res.ok) sendMarket(await ownedSkillsMsg(env)); // re-sync so the panel shows it
        break;
      }
      case "ownedSkills":
        sendMarket(await ownedSkillsMsg(env));
        break;
      case "getBalance":
        sendMarket({ type: "balance", lamports: env.solBalance ? await env.solBalance() : null });
        break;
      // ── RPC config (issue #23): set/clear the Helius key, report status ──
      case "setHeliusKey":
        await env.setHeliusKey?.(); // host opens a native secret input + saves
        if (env.rpcStatus) sendMarket({ type: "rpcStatus", status: await env.rpcStatus() });
        break;
      case "useDefaultRpc":
        await env.useDefaultRpc?.();
        if (env.rpcStatus) sendMarket({ type: "rpcStatus", status: await env.rpcStatus() });
        break;
      case "getRpcStatus":
        if (env.rpcStatus) sendMarket({ type: "rpcStatus", status: await env.rpcStatus() });
        break;
      // issue #34: human posts a comment on a skill from the detail view
      case "postNote": {
        const req = m as Extract<MarketRequest, { type: "postNote" }>;
        const res = env.postNote
          ? await env.postNote(req.skillId, req.skillType, req.text, req.gitLink)
          : { ok: false, error: "comments unavailable" };
        sendMarket({ type: "postNoteResult", skillId: req.skillId, ok: res.ok, error: res.error });
        if (res.ok && res.notes) {
          sendMarket({ type: "notes", skillId: req.skillId, notes: res.notes });
        }
        break;
      }
      // issue #35: agent directory
      case "listAgents": {
        try {
          const agents = env.listAgents ? await env.listAgents() : [];
          sendMarket({ type: "agents", agents });
        } catch (e) {
          sendMarket({ type: "searchError", message: e instanceof Error ? e.message : String(e) });
        }
        break;
      }
      // issue #35: agent profile
      case "getAgentProfile": {
        const req = m as Extract<MarketRequest, { type: "getAgentProfile" }>;
        try {
          if (env.getAgentProfile) {
            const profile = await env.getAgentProfile(req.wallet);
            sendMarket({ type: "agentProfile", profile });
          }
        } catch (e) {
          sendMarket({ type: "searchError", message: e instanceof Error ? e.message : String(e) });
        }
        break;
      }
      // issue #35: buy all skills from an agent (not-yet-owned, capped at 25)
      case "buyAllSkills": {
        const req = m as Extract<MarketRequest, { type: "buyAllSkills" }>;
        const res = env.buyAllSkills
          ? await env.buyAllSkills(req.wallet)
          : { ok: false, bought: 0, failed: 0, error: "buy unavailable" };
        sendMarket({ type: "buyAllResult", wallet: req.wallet, ...res });
        if (res.ok && res.bought > 0) {
          await env.loadOwnedSkills?.();
          sendMarket(await ownedSkillsMsg(env));
        }
        break;
      }
      // issue #35: post self-note (blog) or comment on an agent's profile
      case "postAgentNote": {
        const req = m as Extract<MarketRequest, { type: "postAgentNote" }>;
        const res = env.postAgentNote
          ? await env.postAgentNote(req.agentWallet, req.text, req.gitLink)
          : { ok: false, error: "agent notes unavailable" };
        sendMarket({ type: "agentNoteResult", agentWallet: req.agentWallet, ok: res.ok, error: res.ok ? undefined : (res as { ok: false; error?: string }).error });
        if (res.ok && env.getAgentProfile) {
          // re-push refreshed profile so blog updates without a manual reload
          const profile = await env.getAgentProfile(req.agentWallet).catch(() => null);
          if (profile) sendMarket({ type: "agentProfile", profile });
        }
        break;
      }
      // make-skill: publish a new skill from the UI
      case "publishSkill": {
        const req = m as Extract<MarketRequest, { type: "publishSkill" }>;
        const res = env.publishSkill
          ? await env.publishSkill(req)
          : { ok: false, error: "publishing unavailable" };
        sendMarket({ type: "publishResult", ok: res.ok, mint: res.mint, error: res.error });
        if (res.ok) {
          // a fresh skill is owned by its creator — refresh owned + the market list
          await env.loadOwnedSkills?.();
          if (env.ownedSkills || env.ownedNftSkills) sendMarket(await ownedSkillsMsg(env));
        }
        break;
      }
      // ── passive skill-shopping toggle (issue #21) ──
      case "getSkillShopping":
        await pushSkillShopping();
        break;
      case "setSkillShopping":
        await env.setSkillShopping?.(!!m.on);
        await pushSkillShopping(); // echo the persisted value back so the switch reflects truth
        break;
    }
  }

  return {
    stop() { slots.claude.handle?.stop(); slots.codex.handle?.stop(); },
    // core → UI push for the drive-mirror sync pill. The host wires this to its
    // per-write cloud-status callback (writes are otherwise silent). Not part of the
    // UI→HOST switch — it's an out-of-band event the host originates.
    pushCloudStatus(status: { ok: boolean; error?: string } | null) {
      transport.send({ type: "cloudSync", status });
    },
  };
}
