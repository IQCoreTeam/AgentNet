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
  searchSkills?(query: string): Promise<Array<{ id: string; name: string; description?: string; supply?: number; creator?: string }>>;
  buySkill?(skillId: string, creatorWallet?: string): Promise<{ ok: boolean; slug?: string; error?: string }>;
  ownedSkills?(): Promise<string[]>; // skill names already installed (panel fill)
  // install every owned skill NFT into the runtime skills dir (session start + after a
  // buy), so the agent always has its owned skills present + discoverable. Returns slugs.
  loadOwnedSkills?(): Promise<string[]>;
  // OPTIONAL multi-tab guard: vscode can open the same session in two panels (two
  // tabs writing one log races), so it claims a session before opening and yields
  // false to abort if another panel already holds it. One-socket surfaces (server,
  // android) omit this — there's only ever one view per chat. Called with the id
  // being opened (undefined = a fresh/blank chat, always allowed).
  claimSession?(sessionId: string | undefined): boolean;
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
  type Slot = { handle: SessionHandle | null; pendingId?: string; model?: string };
  const slots: Record<"claude" | "codex", Slot> = {
    claude: { handle: null },
    codex: { handle: null },
  };
  let cli: "claude" | "codex" = "claude"; // which tab is showing
  const slot = () => slots[cli];

  // A handle's output is only painted when ITS cli tab is the active one (so a
  // background reply doesn't bleed into the other tab's log). The message already
  // carries its own .cli (stamped by the runtime), so the UI badges the real engine
  // per-message — correct even for a cross-CLI session.
  function wire(forCli: "claude" | "codex", h: SessionHandle) {
    h.onMessage((msg) => { if (cli === forCli) transport.send({ type: "message", msg }); });
    // a skill firing → the green "Casting <skill>" marquee (issue #17). Transient, not
    // persisted; only painted for the active tab.
    h.onSkill((name) => { if (cli === forCli) transport.send({ type: "skillActive", name }); });
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
    slot().pendingId = sessionId;
    await repaint();
    return true;
  }

  async function ensureHandle() {
    const s = slot();
    if (s.handle) return s.handle;
    const spawnCli = cli; // capture: cli must not change across the await
    s.handle = await rt.startSession({ cli: spawnCli, model: s.model, cwd: env.cwd(), sessionId: s.pendingId, approval: env.approval });
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
        await pushSessions(); await pushStorage(); await open();
        // install the wallet's owned skills so they're present + discoverable this
        // session (issue #17). Fire-and-forget: a chain hiccup must not delay the chat;
        // refresh the panel once it lands.
        void (async () => {
          await env.loadOwnedSkills?.();
          transport.send({ type: "ownedSkills", names: env.ownedSkills ? await env.ownedSkills() : [] });
        })().catch(() => {});
        break;
      case "new":   await open(); await pushSessions(); break;
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
        // model is per-slot; changing it only re-spawns THAT slot's handle next send.
        slot().model = m.model && m.model !== "default" ? m.model : undefined;
        slot().handle?.stop(); slot().handle = null;
        break;
      case "send":
        if (typeof m.text === "string") (await ensureHandle()).send(m.text);
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
              s.handle?.stop(); s.handle = null; s.pendingId = undefined;
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
      case "searchSkills": {
        const results = env.searchSkills ? await env.searchSkills(String(m.query ?? "")) : [];
        transport.send({ type: "searchResults", results });
        break;
      }
      case "buySkill": {
        const res = env.buySkill ? await env.buySkill(String(m.skillId), m.creatorWallet) : { ok: false, error: "buy unavailable" };
        transport.send({ type: "buyResult", skillId: m.skillId, ...res });
        if (res.ok) {
          await env.loadOwnedSkills?.(); // re-sync the whole owned set after the buy
          transport.send({ type: "ownedSkills", names: env.ownedSkills ? await env.ownedSkills() : [] });
        }
        break;
      }
      case "ownedSkills":
        transport.send({ type: "ownedSkills", names: env.ownedSkills ? await env.ownedSkills() : [] });
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
