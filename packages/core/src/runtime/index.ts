// AgentRuntime implementation — wires spawn + parse + append-on-the-fly.
// startSession() spawns the CLI, turns its output into ChatMessages (onMessage),
// and APPENDS each message to the encrypted log as it happens (no full rewrite).
// Messages seen before the real sessionId arrives are queued, then flushed once
// the CLI reveals its id. The UI just calls startSession + send + onMessage.

import { Connection } from "@solana/web3.js";
import { spawnCli } from "./spawn.js";
import { SessionStore } from "../account/store.js";
import { prepareResume } from "./inject/index.js";
import { MemorySync, updateSkillsSection } from "../memory/index.js";
import { getSkillShopping } from "../account/login.js";
import { setSkillShoppingActive } from "../skill-market/passive.js";
import { createAgentSdkMcpServer, newVerifyGuard } from "../skill-market/index.js";
import { getCodexApiKey } from "../account/codexAuth.js";
import type { ApprovalChannel } from "./approval/channel.js";
import type {
  AgentRuntime,
  ChatMessage,
  SessionHandle,
  SessionMeta,
  StorageAdapter,
  Wallet,
} from "./contract.js";

const MARKET_TOOLS = [
  "mcp__agentnet-marketplace__search_skills",
  "mcp__agentnet-marketplace__verify_skill",
  "mcp__agentnet-marketplace__buy_skill",
];

// Skill-shopping wiring (plans/skill-shopping.md), built fresh per session from the
// persisted toggle. ON installs the bundled skill-shopping SKILL.md into both runtimes'
// skills dirs (so either engine discovers it) and — for Claude — wires the marketplace
// MCP tools so the agent can act on it; OFF moves the skill out to the holding dir and
// wires no tools (fully quiet, no marketplace surface). All best-effort: a failure here
// must not block the session, just leave skill-shopping inert this run.
//
// Codex gets the SKILL.md but no MCP tools (codex-sdk exposes no mcpServers option yet —
// deferred); the skill's prose still guides it to the (unavailable) tools, harmlessly.
async function buildPassiveSpawn(
  cli: "claude" | "codex",
  wallet: Wallet,
): Promise<{ mcpServers?: Record<string, unknown>; allowedTools?: string[] }> {
  const on = await getSkillShopping().catch(() => true);

  // Move the bundled skill into / out of the scanned skills dirs (both engines).
  try {
    await setSkillShoppingActive(on);
  } catch (e) {
    console.warn("[skill-shopping] toggle install failed:", e);
  }

  // OFF, or codex (no MCP option yet): the SKILL.md placement above is all we do.
  if (!on || cli === "codex") return {};

  // Claude + ON: wire the marketplace MCP tools (search → verify → buy) with a per-spawn
  // verify guard. Needs a DAS-capable RPC; without one the tools can't read the market, so
  // leave them off (the skill is present but inert) rather than wire dead tools.
  const rpcUrl = process.env.DAS_RPC_URL || process.env.SOLANA_RPC_URL;
  if (!rpcUrl) return {};
  const conn = new Connection(rpcUrl, "confirmed");
  const server = createAgentSdkMcpServer(conn, wallet, wallet.address, newVerifyGuard());
  return { mcpServers: { "agentnet-marketplace": server }, allowedTools: MARKET_TOOLS };
}

// `approval` is the swappable decision source (webview buttons / auto / push). The
// surface passes one in; omit it and tool use auto-allows (safe local default).
export function createRuntime(
  wallet: Wallet,
  storage: StorageAdapter,
  approval?: ApprovalChannel,
): AgentRuntime {
  const store = new SessionStore(wallet, storage);
  // Shared memory (issue #18): same wallet + storage as sessions. Injected into the
  // CLI's native memory files before it starts; captured back from Claude after turns.
  const memory = new MemorySync(wallet, storage);

  return {
    async startSession(opts): Promise<SessionHandle> {
      // RESUME: opts.sessionId is the CANONICAL id. Rewrite its history into the
      // target cli's native jsonl and resume under the NATIVE id (claude/codex only
      // accept their own ids) — this is what lets a session cross between CLIs.
      // FRESH: no sessionId; the cli mints its own, which becomes the canonical id.
      const resuming = !!opts.sessionId;
      const nativeId = resuming
        ? await prepareResume(store, opts.cli, opts.cwd, opts.sessionId!, opts.ephemeral)
        : undefined;

      // Inject the project's shared memory into this CLI's native files (Claude's
      // memory dir / Codex's AGENTS.md) BEFORE it starts so it loads this run. Best
      // effort — a memory/storage hiccup must not block starting the session.
      try {
        await memory.injectAtStart(opts.cli, opts.cwd);
        // After memory is written, refresh the managed "your skills" line so the agent
        // passively knows which skills are installed (no system-prompt nudge, no RPC).
        // Must run AFTER injectAtStart, which regenerates MEMORY.md / AGENTS.md.
        await updateSkillsSection(opts.cli, opts.cwd);
      } catch (e) {
        console.warn("[memory] inject failed:", e);
      }

      // Skill-shopping (plans/skill-shopping.md): install/remove the bundled skill per the
      // toggle + (Claude, ON) wire the marketplace MCP tools. Best-effort.
      let passive: Awaited<ReturnType<typeof buildPassiveSpawn>> = {};
      try {
        passive = await buildPassiveSpawn(opts.cli, wallet);
      } catch (e) {
        console.warn("[skill-shopping] setup failed:", e);
      }

      // per-session approval channel (each panel passes its own) wins; fall back to
      // the runtime-level default channel.
      const apiKey = opts.apiKey || (opts.cli === "codex" ? (await getCodexApiKey().catch(() => undefined)) ?? undefined : undefined);
      const cli = spawnCli({ ...opts, sessionId: nativeId, approval: opts.approval ?? approval, apiKey, ...passive });

      // Storage key stays the CANONICAL id while resuming; the cli's emitted (native)
      // id must NOT overwrite it, or appended turns land in the wrong log.
      let sessionId = opts.sessionId ?? ""; // canonical; "" until a fresh cli reveals it
      let title = "";
      const msgCbs: Array<(m: ChatMessage) => void> = [];
      const turnCbs: Array<() => void> = [];
      const skillCbs: Array<(name: string) => void> = []; // "Casting <skill>" marquee
      const usageCbs: Array<(n: number) => void> = [];
      const pending: ChatMessage[] = []; // messages awaiting a known sessionId

      const meta = () => ({ sessionId, cli: opts.cli, title, ts: Date.now() });

      // Show the message to the UI, then append it to the encrypted log. Stamp the
      // producing CLI on every message so the UI badges each turn with the right
      // engine even in a cross-CLI session. Before sessionId is known, queue;
      // flush() drains the queue once it is.
      const emit = (m: ChatMessage) => {
        if (!m.cli) m.cli = opts.cli;
        if (!title && m.role === "user") title = m.text.slice(0, 60);
        for (const cb of msgCbs) cb(m);
        // streaming deltas are for the live UI only — never persist them. The final
        // (partial:false) assistant message carries the full text and IS stored below.
        if (m.partial) return;
        if (opts.ephemeral) return; // Do not save ephemeral messages to the store.
        if (sessionId) void store.appendMessage(meta(), m);
        else pending.push(m);
      };

      const flush = async () => {
        while (pending.length) await store.appendMessage(meta(), pending.shift()!);
      };

      // Engine events (already mapped to ChatMessages by spawn/convert). A FRESH
      // session adopts the engine's revealed id as canonical; while resuming, the
      // canonical id is already set so onSessionId is a no-op for us.
      cli.onSessionId((id: string) => {
        if (sessionId) return;
        sessionId = id;
        void flush();
      });
      cli.onMessage((m: ChatMessage) => emit(m));
      // A skill firing is a transient UI cue, not a transcript entry — fan it out to
      // listeners without persisting it (issue #17).
      cli.onSkill((name: string) => { for (const cb of skillCbs) cb(name); });
      cli.onUsage((n: number) => { for (const cb of usageCbs) cb(n); });
      cli.onTurnEnd(() => {
        if (opts.ephemeral) {
          for (const cb of turnCbs) cb();
          return;
        }
        void flush().then(() => {
          for (const cb of turnCbs) cb();
        });
        // Capture any memory Claude wrote this turn back to Drive (stock Codex never
        // writes memory, so only Claude is captured). Fire-and-forget; best effort.
        if (opts.cli === "claude") {
          void memory.captureFromClaude(opts.cwd).catch((e) =>
            console.warn("[memory] capture failed:", e),
          );
        }
      });

      // Surface failures instead of going silent: an engine error shows as a tool
      // message and ends the turn so the UI unblocks (it used to wait forever).
      let stopped = false; // we asked it to stop (tab/model switch) → not an error
      cli.onError((text: string) => {
        if (stopped) return;
        emit({ role: "tool", text, ts: Date.now() });
        void flush().then(() => {
          for (const cb of turnCbs) cb();
        });
      });

      return {
        get sessionId() {
          return sessionId;
        },
        cli: opts.cli,
        send(userText: string, images?: import("./contract.js").ImageInput[]) {
          // Persist only a COUNT of attached images, never the base64 (keeps the encrypted
          // log small). The live UI still gets thumbnails — it holds the originals itself.
          emit({ role: "user", text: userText, ts: Date.now(), imageCount: images?.length || undefined });
          cli.send(userText, images);
        },
        onMessage(cb) {
          msgCbs.push(cb);
        },
        onTurnEnd(cb) {
          turnCbs.push(cb);
        },
        onSkill(cb) {
          skillCbs.push(cb);
        },
        onUsage(cb) {
          usageCbs.push(cb);
        },
        interrupt() {
          cli.interrupt(); // stop the current turn; the session stays open for the next send
        },
        stop() {
          stopped = true; // mark so the resulting exit isn't reported as a failure
          cli.stop();
        },
        updateMode(mode) {
          cli.updateMode?.(mode);
        },
      };
    },

    async listSessions(): Promise<SessionMeta[]> {
      return store.listMine();
    },

    async loadSession(sessionId: string) {
      return store.loadLatest(sessionId); // newest page + cursor to older
    },

    async loadMore(sessionId: string, cursor: number) {
      return store.loadOlder(sessionId, cursor); // the page before `cursor`
    },

    async deleteSession(sessionId: string): Promise<void> {
      await store.remove(sessionId);
    },
  };
}
