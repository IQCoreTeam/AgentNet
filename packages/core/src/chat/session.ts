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

// Format a token count with thousands separators (e.g. 167000 → "167,000") for the
// /context breakdown notice.
function fmtTok(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

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
  // Re-run sign-in for the ALREADY-configured backend after a dead token (invalid_grant).
  // Optional: a surface that reconnects via its own flow (e.g. localhost's Google login,
  // which needs the client to stream the auth URL back) leaves this unset and handles the
  // reconnectCloud message itself; its no-op here is harmless.
  reconnectCloud?(cfg: { kind?: string }): Promise<void>;
  disconnectWallet?(): Promise<void>;
  openCloud?(kind: string, location?: string): Promise<void>;
  walletAddress(): string | null; // for the "My Wallet" view
  storageInfo(): Promise<{ info: unknown; options: unknown; googleCredsConfigured?: boolean }>; // header storage pill
  // marketplace (issue #17): search + buy need the wallet + a chain connection, which
  // are host-held (the extension owns them), so they're delegated like wallet/cloud.
  // buySkill installs the bought skill's SKILL.md into the runtime skills dir as part
  // of the buy (the host calls SkillSync.installBought), returning the installed slug.
  searchSkills?(query: string, kind?: "skill" | "workflow", sort?: "supply" | "stars"): Promise<SkillCard[]>;
  getSkillDetail?(mint: string): Promise<import("./marketMessages.js").SkillDetail>;
  getSkillDoc?(name: string): Promise<string | null>;
  buySkill?(skillId: string, creatorWallet?: string): Promise<{ ok: boolean; slug?: string; error?: string; code?: "insufficient_funds" }>;
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
  postAgentNote?(agentWallet: string, text: string, gitLink?: string, title?: string, image?: string, parentId?: string): Promise<{ ok: boolean; notes?: import("./marketMessages.js").Note[]; error?: string }>;
  solBalance?(): Promise<number | null>; // wallet's native SOL balance (lamports), for the UI funds display
  // devnet-only: fund the wallet from the faucet (manual "Get devnet SOL" on an insufficient-
  // funds buy). Returns the new balance so the UI refreshes and lets the buyer retry.
  airdrop?(): Promise<{ ok: boolean; lamports?: number; error?: string }>;
  // GitHub verified-work registration (issue #93 parity). getGithubStatus reports whether a
  // token is saved; submitGithubToken stores one; registerWorkRepo commits + indexes an
  // owner/name repo against the given skill mints. All three defer to core (rpc.ts token
  // store + verifiedWork.ts). A surface that can't do this simply omits them.
  getGithubStatus?(): Promise<{ hasToken: boolean; masked?: string }>;
  submitGithubToken?(token: string): Promise<{ hasToken: boolean; masked?: string }>;
  registerWorkRepo?(repo: string, skillMints: string[]): Promise<{ ok: boolean; count?: number; repo?: string; error?: string }>;
  // make-skill: publish a new skill from the UI. priceSol is the human SOL string; the
  // host converts to lamports and calls core publishSkill. Returns the new mint on success.
  // onProgress (optional to honor) streams the multi-signature mint gauge — the dispatcher
  // forwards it as `publishProgress` market events.
  publishSkill?(input: {
    name: string;
    description: string;
    text: string;
    category?: string;
    hashtags?: string[];
    priceSol: string;
    image?: string;
  }, onProgress?: (p: { phase: "store" | "mint" | "list"; signed: number; total?: number; percent?: number; kind: "skill" | "workflow" }) => void): Promise<{ ok: boolean; mint?: string; error?: string }>;
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
async function ownedSkillsMsg(env: ChatEnv): Promise<{ type: "ownedSkills"; names: string[]; mints?: Record<string, string>; disposedMints?: Record<string, string>; workflowMints?: string[] }> {
  const names = await ownedNames(env);
  const mints = env.ownedSkillMints ? await env.ownedSkillMints().catch(() => ({}) as Record<string, string>) : {};
  const disposedMints = env.disposedSkillMints ? await env.disposedSkillMints().catch(() => ({}) as Record<string, string>) : {};
  // Which owned mints are actually workflows (not skills). A workflow can't be a
  // required_skill of another workflow (the publish contract rejects it), and a
  // locally-installed workflow mint is indistinguishable from a skill mint here, so
  // the workflow builder needs this to keep them out of its picker. Best-effort: one
  // batched on-chain read; empty on any failure so the common path never blocks.
  const allMints = [...Object.values(mints), ...Object.values(disposedMints)];
  const workflowMints = allMints.length
    ? await import("../core/skillSource.js").then((m) => m.workflowMintsAmong(allMints)).catch(() => [] as string[])
    : [];
  return { type: "ownedSkills", names, mints, disposedMints, workflowMints };
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
): { stop: () => void; pushCloudStatus: (s: { ok: boolean; error?: string; reason?: "reauth" | "transient" } | null) => void } {
  // Both CLIs stay "on" at once: each has its OWN slot (handle + which session +
  // model), so claude and codex never step on each other. A handle is spawned lazily
  // on first send (spawn costs ~2s); codex re-spawns per turn internally anyway.
  //
  // Switch-away lifecycle (don't burn a CLI process per backgrounded chat). When you
  // open a DIFFERENT session, the one you're leaving is handled by its state:
  //   • mid-turn — working, OR blocked awaiting your approval/answer — → kept ALIVE in
  //     `parked` and flagged in `retire`; the instant that turn ends in the background
  //     it's stopped. Returning before then reuses the live handle (no respawn). An
  //     approval-blocked turn hasn't fired onTurnEnd, so it naturally stays alive — that
  //     IS "keep it on while it's waiting for the user".
  //   • idle — no turn running — → stopped immediately to free the process.
  // Either way the sessionId survives in the session list, so returning to a stopped
  // session lazy-resumes it from storage on the next send (~2s respawn — acceptable).
  // `busy` is what tells idle from working (set when a turn starts in ensureHandle,
  // cleared on onTurnEnd).
  // `restage` = a config (model/mode) changed while a handle was live. We DON'T tear
  // the handle down on the toggle — that would interrupt an in-flight turn (claude
  // q.interrupt / codex child.kill). Instead we re-spawn lazily on the next send,
  // carrying the live session over, so the running turn finishes untouched and the new
  // setting applies from the next message.
  type Slot = {
    handle: SessionHandle | null;
    parked: Set<SessionHandle>;
    pendingId?: string;
    model?: string;
    mode?: string;
    effort?: "low" | "medium" | "high" | "xhigh" | "max";
    restage?: SessionHandle | null;
    lastUsage?: number;
    lastWindow?: number;
  };
  const slots: Record<"claude" | "codex", Slot> = {
    claude: { handle: null, parked: new Set(), mode: "acceptEdits", restage: null },
    codex: { handle: null, parked: new Set(), mode: "auto", restage: null },
  };
  let cli: "claude" | "codex" = "claude"; // which tab is showing
  const slot = () => slots[cli];

  // Handles with a turn in flight (set in ensureHandle when a turn starts, cleared in
  // wire()'s onTurnEnd). A send/slash-command turn that blocks awaiting your approval
  // counts as busy — its turn hasn't ended — so it's kept alive on switch-away.
  const busy = new Set<SessionHandle>();
  // Parked handles to stop the moment their background turn ends (flagged on switch-away
  // from a busy session). Cleared if you switch back before that turn ends.
  const retire = new Set<SessionHandle>();

  function isVisibleHandle(forCli: "claude" | "codex", h: SessionHandle): boolean {
    return cli === forCli && slots[forCli].handle === h;
  }

  function findParkedHandle(s: Slot, sessionId: string | undefined): SessionHandle | null {
    if (!sessionId) return null;
    for (const h of s.parked) {
      if (h.sessionId === sessionId) return h;
    }
    return null;
  }

  function stopHandle(s: Slot, h: SessionHandle): void {
    if (s.handle === h) s.handle = null;
    s.parked.delete(h);
    if (s.restage === h) s.restage = null;
    busy.delete(h);
    retire.delete(h);
    h.stop();
  }

  // typed host->UI marketplace push: the contract (marketMessages.ts) is enforced
  // here, so a wrong field/type on a market event is a compile error, not a silent
  // runtime miss. Every surface's UI reads the same shape.
  const sendMarket = (e: import("./marketMessages.js").MarketEvent) => transport.send(e);

  // A handle's output is only painted when ITS cli tab is the active one (so a
  // background reply doesn't bleed into the other tab's log). The message already
  // carries its own .cli (stamped by the runtime), so the UI badges the real engine
  // per-message — correct even for a cross-CLI session.
  function wire(forCli: "claude" | "codex", h: SessionHandle) {
    h.onMessage((msg) => { if (isVisibleHandle(forCli, h)) transport.send({ type: "message", msg }); });
    // a skill firing → the green "Casting <skill>" marquee (issue #17). Transient, not
    // persisted; only painted for the active tab.
    h.onSkill((name) => { if (isVisibleHandle(forCli, h)) sendMarket({ type: "skillActive", name }); });
    // token usage: forward to the active surface so it can render a context meter. The
    // window (when the engine reports it) lets the UI show a percentage, not a bare count.
    // Only the visible handle updates the slot's last-seen usage — a parked/background
    // session must not overwrite the meter for the chat the user is actually looking at.
    h.onUsage((contextTokens, contextWindow) => {
      if (isVisibleHandle(forCli, h)) {
        slots[forCli].lastUsage = contextTokens;
        if (contextWindow !== undefined) slots[forCli].lastWindow = contextWindow;
        transport.send({ type: "usage", contextTokens, contextWindow: slots[forCli].lastWindow });
      }
    });
    // compaction: the engine condensed history to reclaim context. Cue the active surface
    // (a notice + the next usage update reflects the reclaimed space).
    h.onCompact(() => {
      if (isVisibleHandle(forCli, h)) transport.send({ type: "compacted" });
    });
    h.onTurnEnd(async () => {
      busy.delete(h);
      if (isVisibleHandle(forCli, h)) transport.send({ type: "turnEnd" }); // stop the typing dots
      await pushSessions();
      // A backgrounded session that just finished its in-flight turn is retired here:
      // stop the CLI process now; returning lazy-resumes it from storage. Only when still
      // parked (the user didn't switch back to it) and flagged for retirement on switch-away.
      const bg = slots[forCli];
      if (retire.has(h) && bg.parked.has(h)) {
        console.log(`[session] retired backgrounded ${String(h.sessionId).slice(0, 8)} (turn ended)`);
        stopHandle(bg, h);
      }
    });
  }

  // Repaint the log for the current tab from its slot (history of pending session).
  // Each stored message carries its own .cli, so badges reflect the engine that
  // actually produced each turn — not the current tab.
  async function repaint() {
    transport.send({ type: "clear" });
    const id = slot().pendingId;
    if (!id) return;
    // Show the loading state while we read the session. CRITICAL: the paint path reads the
    // LOCAL tier ONLY (loadSessionLocal) so it can NEVER block on a stalled Drive read. A
    // hung cloud fetch used to leave "Resuming…" spinning forever — the spinner clears ONLY
    // on `page`, and a request that never settles never reaches it (a try/catch catches a
    // throw, not a hang). Local is instant and can't hang, so `page` is always sent.
    transport.send({ type: "loading" });
    let localCount = 0;
    let localNewestTs = 0;
    try {
      const page = await rt.loadSessionLocal(id);
      for (const msg of page.messages) transport.send({ type: "message", msg });
      transport.send({ type: "page", hasMore: page.hasMore, cursor: page.cursor });
      localCount = page.messages.length;
      if (localCount) localNewestTs = page.messages[localCount - 1].ts ?? 0;
    } catch (err) {
      console.error(`[session] loadSessionLocal failed for ${String(id).slice(0, 8)}:`, err);
      transport.send({ type: "page", hasMore: false, cursor: 0 }); // release the spinner
    }
    // Reconcile from the mirror (local-then-cloud) OFF the paint path. The instant local paint
    // above can be STALE: the just-ended turn may not have flushed to disk yet (so an engine
    // switch, which repaints, would show a blank/partial chat until a manual reload), or the
    // session may carry newer turns from another device. Re-read and ADOPT the result only
    // when it is FRESHER than what we painted — a newer last-turn ts, or local was empty — so
    // a fresher local view is never clobbered by a staler mirror copy. Guard on pendingId so a
    // late result can't overwrite a tab the user switched away from. (The old guard reconciled
    // only when local was EMPTY, so a stale-but-nonempty local page stuck until a reload — the
    // "model switch wipes the chat" bug. Now it self-heals with no refresh.)
    void (async () => {
      try {
        const page = await rt.loadSession(id); // mirror: newest page across local+cloud
        if (slot().pendingId !== id) return;   // user switched tabs while we waited
        if (!page.messages.length) return;     // nothing to adopt — leave the local paint as-is
        const newestTs = page.messages[page.messages.length - 1].ts ?? 0;
        if (localCount > 0 && newestTs <= localNewestTs) return; // local already as fresh
        transport.send({ type: "clear" });
        for (const msg of page.messages) transport.send({ type: "message", msg });
        transport.send({ type: "page", hasMore: page.hasMore, cursor: page.cursor });
      } catch (err) {
        console.error(`[session] cloud reconcile failed for ${String(id).slice(0, 8)}:`, err);
      }
    })();
  }

  // Open a session into the CURRENT tab's slot — cross-CLI: opening a session
  // continues that canonical conversation in WHATEVER cli the tab is on (the runtime
  // re-injects its history into that cli on resume). A fresh handle is spawned lazily
  // on the next send. Returns false if the host's multi-tab guard rejected the open
  // (the session is live in another panel) — the caller skips the follow-up paint.
  async function open(sessionId?: string): Promise<boolean> {
    if (env.claimSession && !env.claimSession(sessionId)) return false;
    const s = slot();
    if (s.handle?.sessionId === sessionId) {
      s.pendingId = sessionId;
      await repaint();
      return true;
    }
    if (s.handle) {
      const leaving = s.handle;
      if (busy.has(leaving)) {
        // a turn is in flight (working, or blocked awaiting your approval/answer) — never
        // kill it mid-turn. Park it alive; it's retired the instant its turn ends.
        s.parked.add(leaving);
        retire.add(leaving);
        s.handle = null;
        console.log(`[session] switch-away: parked working ${String(leaving.sessionId).slice(0, 8)} (retire when its turn ends)`);
      } else {
        // idle — stop now to free the process. The session list keeps the id, so
        // returning lazy-resumes it from storage on the next send.
        console.log(`[session] switch-away: stopped idle ${String(leaving.sessionId).slice(0, 8)}`);
        stopHandle(s, leaving);
      }
    }
    const parked = findParkedHandle(s, sessionId);
    if (parked) {
      s.parked.delete(parked);
      retire.delete(parked); // switched back before its turn ended — cancel retirement
      s.handle = parked;
    }
    s.pendingId = sessionId;
    await repaint();
    return true;
  }

  async function ensureHandle() {
    const s = slot();
    if (!s.handle || s.restage === s.handle) {
      // (Re)spawn needed. A model/mode change since the last spawn: retire the old handle
      // HERE (turn is idle — we're about to send), carrying its live sessionId into pendingId
      // so the re-spawn RESUMES the same canonical session instead of starting a blank one.
      if (s.handle && s.restage === s.handle) {
        s.pendingId = s.handle.sessionId || s.pendingId;
        stopHandle(s, s.handle);
      }
      const spawnCli = cli; // capture: cli must not change across the await
      s.handle = await rt.startSession({ cli: spawnCli, model: s.model, mode: s.mode, effort: s.effort, cwd: env.cwd(), sessionId: s.pendingId, approval: env.approval, onMarketEvent: sendMarket });
      wire(spawnCli, s.handle);
    }
    // Every caller of ensureHandle is about to drive a turn (send / slash command), so the
    // handle is now busy until its onTurnEnd. This is what keeps a backgrounded working (or
    // approval-blocked) session alive on switch-away; an idle one is stopped instead.
    const h = s.handle!;
    busy.add(h);
    return h;
  }

  async function pushSessions() {
    const list = await rt.listSessions();
    const activeId = slot().handle?.sessionId ?? slot().pendingId;
    // cloud reflects THIS list's union (read after listSessions): "reauth"/"transient"
    // mean the cloud tier failed and `list` is silently local-only — the UI labels it
    // so missing remote sessions read as "sync is down", not "they don't exist".
    transport.send({ type: "sessions", list, activeId, cloud: rt.cloudState?.() ?? "none" });
  }

  async function pushStorage() {
    const { info, options, googleCredsConfigured } = await env.storageInfo();
    transport.send({ type: "storage", info, options, googleCredsConfigured });
  }

  async function pushSkillShopping() {
    // default ON when the host doesn't offer the toggle (matches login.ts default).
    const on = env.getSkillShopping ? await env.getSkillShopping() : true;
    transport.send({ type: "skillShopping", on });
  }

  async function pushModelOptions(forCli: "claude" | "codex") {
    if (!env.modelOptions) return;
    const options = await env.modelOptions(forCli).catch(() => null);
    // Empty/failed probe → leave the webview on its static baseline (listClaudeModelOptions
    // already logs the reason). Only override the picker when we have a live list.
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
        // Push the ACTIVE engine's live model catalog (claude by default). The old code
        // only pushed codex, so a fresh claude session never received its dynamic list and
        // kept showing the static baseline. Switching engines pushes the other side.
        void pushModelOptions(cli);
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
        if (slot().handle) stopHandle(slot(), slot().handle!);
        slot().pendingId = undefined;
        slot().restage = null;
        await repaint();
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
        if (slot().handle) slot().restage = slot().handle;
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
            slot().restage = h;
          }
        }
        break;
      case "effort": {
        // reasoning effort is per-slot. Same lazy-restage rule as model/mode: never kill
        // a live turn — the new effort takes effect from the next spawned handle.
        const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
        const e = EFFORTS.find((v) => v === m.effort);
        slot().effort = e;
        if (slot().handle) slot().restage = slot().handle;
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
              contextWindow: s.lastWindow,
            },
          });
          break;
        }
        // /context — local breakdown of context-window occupancy (no native call). Mirrors
        // Claude Code's `/context`: used / window / free / auto-compact threshold. We don't
        // have per-category token data from the engines, so we report the totals we do have.
        if (command === "context") {
          const s = slot();
          const window = s.lastWindow ?? (cli === "codex" ? 256_000 : 200_000);
          if (s.lastUsage === undefined) {
            transport.send({ type: "notice", text: `Context: 0 / ${fmtTok(window)} tokens — send a message to measure usage.` });
            break;
          }
          const used = s.lastUsage;
          const free = Math.max(0, window - used);
          const pct = Math.round((used / window) * 100);
          // auto-compact reserve: ~20k for the model's reply + ~13k summary headroom,
          // matching Claude Code's effectiveWindow − 13k formula.
          const threshold = Math.max(0, window - 33_000);
          const tpct = Math.round((threshold / window) * 100);
          transport.send({
            type: "notice",
            text:
              `Context window (${cli})\n` +
              `  used    ${fmtTok(used)} / ${fmtTok(window)} (${pct}%)\n` +
              `  free    ${fmtTok(free)}\n` +
              `  auto-compact at ~${fmtTok(threshold)} (${tpct}%)`,
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
              if (s.handle) stopHandle(s, s.handle);
              s.pendingId = undefined;
            }
            for (const h of [...s.parked]) {
              if (h.sessionId === m.sessionId) stopHandle(s, h);
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
      case "reconnectCloud":  await env.reconnectCloud?.({ kind: m.kind }); await pushStorage(); await pushSessions(); break;
      case "disconnectWallet": await env.disconnectWallet?.(); break;
      case "openCloud":       await env.openCloud?.(m.kind, m.location); break;
      case "wallet":          transport.send({ type: "wallet", address: env.walletAddress() }); break;
      // ── marketplace: search → buy → install (delegated to the host) ──
      // payload typed via the shared contract (marketMessages.ts) so a wrong field
      // is caught here, not at runtime on some surface.
      case "searchSkills": {
        const req = m as Extract<MarketRequest, { type: "searchSkills" }>;
        try {
          const results = env.searchSkills ? await env.searchSkills(req.query ?? "", req.kind, req.sort) : [];
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
        // Another handler may own buys on this surface (e.g. the localhost market handler).
        // POST fans out to every recv, so emitting a "buy unavailable" result here when we
        // lack the capability would race the real handler's success with a phantom failure.
        // Stay silent instead — the capable handler answers.
        if (!env.buySkill) break;
        const res = await env.buySkill(req.skillId, req.creatorWallet);
        sendMarket({ type: "buyResult", skillId: req.skillId, ...res });
        if (res.ok) {
          await env.loadOwnedSkills?.(); // re-sync the whole owned set after the buy
          sendMarket(await ownedSkillsMsg(env));
        }
        break;
      }
      case "disposeSkill": {
        const req = m as Extract<MarketRequest, { type: "disposeSkill" }>;
        if (!env.disposeSkill) break; // another handler owns this on some surfaces — don't emit a phantom failure
        const res = await env.disposeSkill(req.skillId);
        sendMarket({ type: "disposeResult", skillId: req.skillId, ...res });
        if (res.ok) sendMarket(await ownedSkillsMsg(env)); // re-sync so the panel drops it
        break;
      }
      case "reEquipSkill": {
        const req = m as Extract<MarketRequest, { type: "reEquipSkill" }>;
        if (!env.reEquipSkill) break; // another handler owns this on some surfaces — don't emit a phantom failure
        const res = await env.reEquipSkill(req.skillId);
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
      case "airdrop": {
        if (!env.airdrop) break; // another handler owns this on some surfaces (e.g. localhost)
        const res = await env.airdrop();
        sendMarket({ type: "airdropResult", ...res });
        break;
      }
      // ── GitHub verified-work registration (issue #93 parity) ──
      // Each guards on the capability so surfaces that own this on their own handler
      // (e.g. localhost) fall through instead of getting a phantom response here.
      case "getGithubStatus": {
        if (!env.getGithubStatus) break;
        sendMarket({ type: "githubStatus", ...(await env.getGithubStatus()) });
        break;
      }
      case "submitGithubToken": {
        const req = m as Extract<MarketRequest, { type: "submitGithubToken" }>;
        if (!env.submitGithubToken) break;
        sendMarket({ type: "githubStatus", ...(await env.submitGithubToken(req.token)) });
        break;
      }
      case "registerWorkRepo": {
        const req = m as Extract<MarketRequest, { type: "registerWorkRepo" }>;
        if (!env.registerWorkRepo) break;
        sendMarket({ type: "workRepoRegistered", ...(await env.registerWorkRepo(req.repo, req.skillMints)) });
        break;
      }
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
        if (!env.postNote) break; // another handler owns this on some surfaces — don't emit a phantom failure
        const res = await env.postNote(req.skillId, req.skillType, req.text, req.gitLink);
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
        if (!env.buyAllSkills) break; // another handler owns this on some surfaces — don't emit a phantom failure
        const res = await env.buyAllSkills(req.wallet);
        sendMarket({ type: "buyAllResult", wallet: req.wallet, ...res });
        if (res.ok && res.bought > 0) {
          await env.loadOwnedSkills?.();
          sendMarket(await ownedSkillsMsg(env));
        }
        break;
      }
      // Buy a specific set (a workflow's required skills) in one tap. Reuses env.buySkill
      // per item and reports a single aggregate buyAllResult (one toast, not N).
      case "buyRequiredSkills": {
        const req = m as Extract<MarketRequest, { type: "buyRequiredSkills" }>;
        if (!env.buySkill) break; // capable handler answers; stay silent otherwise
        let bought = 0, failed = 0;
        for (const item of req.items) {
          const r = await env.buySkill(item.skillId, item.creatorWallet);
          if (r.ok) bought++; else failed++;
        }
        sendMarket({ type: "buyAllResult", wallet: "", ok: failed === 0, bought, failed });
        if (bought > 0) {
          await env.loadOwnedSkills?.();
          sendMarket(await ownedSkillsMsg(env));
        }
        break;
      }
      // issue #35: post self-note (blog) or comment on an agent's profile
      case "postAgentNote": {
        const req = m as Extract<MarketRequest, { type: "postAgentNote" }>;
        if (!env.postAgentNote) break; // another handler owns this on some surfaces — don't emit a phantom failure
        const res = await env.postAgentNote(req.agentWallet, req.text, req.gitLink, req.title, req.image, req.parentId);
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
        if (!env.publishSkill) break; // another handler owns this on some surfaces — don't emit a phantom failure
        // Stream the multi-signature mint progress to the UI. Local keypair wallets sign
        // silently but still tick the counter (core trackSignatures), so the forge gauge
        // runs without any prompt — hosts whose publishSkill ignores the callback just
        // show no gauge, same as before.
        const res = await env.publishSkill(req, (p) =>
          sendMarket({ type: "publishProgress", phase: p.phase, signed: p.signed, total: p.total, percent: p.percent, kind: p.kind }));
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
    stop() {
      for (const s of [slots.claude, slots.codex]) {
        if (s.handle) stopHandle(s, s.handle);
        for (const h of [...s.parked]) stopHandle(s, h);
      }
    },
    // core → UI push for the drive-mirror sync pill. The host wires this to its
    // per-write cloud-status callback (writes are otherwise silent). Not part of the
    // UI→HOST switch — it's an out-of-band event the host originates.
    pushCloudStatus(status: { ok: boolean; error?: string; reason?: "reauth" | "transient" } | null) {
      transport.send({ type: "cloudSync", status });
    },
  };
}
