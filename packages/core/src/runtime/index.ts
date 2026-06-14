// AgentRuntime implementation — wires spawn + parse + append-on-the-fly.
// startSession() spawns the CLI, turns its output into ChatMessages (onMessage),
// and APPENDS each message to the encrypted log as it happens (no full rewrite).
// Messages seen before the real sessionId arrives are queued, then flushed once
// the CLI reveals its id. The UI just calls startSession + send + onMessage.

import { Connection } from "@solana/web3.js";
import { spawnCli } from "./spawn.js";
import { SessionStore } from "../account/store.js";
import { prepareResume } from "./inject/index.js";
import { MemorySync } from "../memory/index.js";
import { getSkillShopping } from "../account/login.js";
import {
  installPassiveSkill,
  writeCodexSkills,
  passiveWorkflowProse,
  type PassiveMode,
} from "../skill-market/passive.js";
import { createAgentSdkMcpServer, newVerifyGate } from "../skill-market/index.js";
import { getSolBalance, TX_FEE_BUFFER_LAMPORTS } from "../notes/solBalance.js";
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
  "mcp__agentnet-marketplace__wallet_balance",
  "mcp__agentnet-marketplace__verify_skill",
  "mcp__agentnet-marketplace__buy_skill",
];

// OFF mode read-only set: price a missing capability + check funds, but never verify/buy.
const MARKET_TOOLS_READONLY = [
  "mcp__agentnet-marketplace__search_skills",
  "mcp__agentnet-marketplace__wallet_balance",
];

// Passive skill-shopping wiring (issue #21), built fresh per session from the persisted
// toggle. Force-loads the workflow skill into both runtimes; for Claude it returns the
// SDK extras (MCP marketplace server + allowed tools + workflow prose); for Codex it
// splices the directive into AGENTS.md. All best-effort — a failure here must not block
// the session, just leave skill-shopping inert this run.
async function buildPassiveSpawn(
  cli: "claude" | "codex",
  cwd: string,
  wallet: Wallet,
): Promise<{ appendSystemPrompt?: string; mcpServers?: Record<string, unknown>; allowedTools?: string[] }> {
  const on = await getSkillShopping().catch(() => true);

  const rpcUrl = process.env.DAS_RPC_URL || process.env.SOLANA_RPC_URL;
  const conn = rpcUrl ? new Connection(rpcUrl, "confirmed") : null;

  // OFF funds-gate: only allow the single buy-suggestion when the wallet is actually
  // funded. No RPC or empty wallet → fully silent OFF (never nag an empty wallet).
  let offCanSuggest = false;
  if (!on && conn) {
    try {
      offCanSuggest = (await getSolBalance(conn, wallet.address)) > TX_FEE_BUFFER_LAMPORTS;
    } catch {
      offCanSuggest = false;
    }
  }
  const mode: PassiveMode = { on, offCanSuggest };

  try {
    await installPassiveSkill(mode);
  } catch (e) {
    console.warn("[skill-shopping] install workflow skill failed:", e);
  }

  if (cli === "codex") {
    try {
      await writeCodexSkills(cwd, mode);
    } catch (e) {
      console.warn("[skill-shopping] codex AGENTS.md splice failed:", e);
    }
    return {}; // Codex MCP (TOML) is deferred — the directive lives in AGENTS.md.
  }

  // Claude: append the workflow prose, then wire the marketplace MCP tools per mode:
  //  • ON           → full set (search + verify + buy) with a hard verify gate.
  //  • OFF + funded  → READ-ONLY set (search + wallet_balance) so the agent can price a
  //                    missing capability and funds-gate a SUGGESTION; verify/buy absent.
  //  • OFF + empty   → no tools at all (fully silent).
  const extra: { appendSystemPrompt?: string; mcpServers?: Record<string, unknown>; allowedTools?: string[] } = {
    appendSystemPrompt: passiveWorkflowProse(mode),
  };
  if (conn && (on || offCanSuggest)) {
    const server = createAgentSdkMcpServer(conn, wallet, wallet.address, newVerifyGate(), { includeBuy: on });
    extra.mcpServers = { "agentnet-marketplace": server };
    extra.allowedTools = on ? MARKET_TOOLS : MARKET_TOOLS_READONLY;
  }
  return extra;
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
        ? await prepareResume(store, opts.cli, opts.cwd, opts.sessionId!)
        : undefined;

      // Inject the project's shared memory into this CLI's native files (Claude's
      // memory dir / Codex's AGENTS.md) BEFORE it starts so it loads this run. Best
      // effort — a memory/storage hiccup must not block starting the session.
      try {
        await memory.injectAtStart(opts.cli, opts.cwd);
      } catch (e) {
        console.warn("[memory] inject failed:", e);
      }

      // Passive skill-shopping (issue #21): force-load the workflow + (Claude, ON) wire
      // the marketplace MCP tools, per the persisted toggle. Best-effort.
      let passive: Awaited<ReturnType<typeof buildPassiveSpawn>> = {};
      try {
        passive = await buildPassiveSpawn(opts.cli, opts.cwd, wallet);
      } catch (e) {
        console.warn("[skill-shopping] setup failed:", e);
      }

      // per-session approval channel (each panel passes its own) wins; fall back to
      // the runtime-level default channel.
      const cli = spawnCli({ ...opts, sessionId: nativeId, approval: opts.approval ?? approval, ...passive });

      // Storage key stays the CANONICAL id while resuming; the cli's emitted (native)
      // id must NOT overwrite it, or appended turns land in the wrong log.
      let sessionId = opts.sessionId ?? ""; // canonical; "" until a fresh cli reveals it
      let title = "";
      const msgCbs: Array<(m: ChatMessage) => void> = [];
      const turnCbs: Array<() => void> = [];
      const skillCbs: Array<(name: string) => void> = []; // "Casting <skill>" marquee
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
      cli.onTurnEnd(() => {
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
        send(userText: string) {
          emit({ role: "user", text: userText, ts: Date.now() });
          cli.send(userText);
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
        stop() {
          stopped = true; // mark so the resulting exit isn't reported as a failure
          cli.stop();
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
