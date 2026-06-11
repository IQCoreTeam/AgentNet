// AgentRuntime implementation — wires spawn + parse + append-on-the-fly.
// startSession() spawns the CLI, turns its output into ChatMessages (onMessage),
// and APPENDS each message to the encrypted log as it happens (no full rewrite).
// Messages seen before the real sessionId arrives are queued, then flushed once
// the CLI reveals its id. The UI just calls startSession + send + onMessage.

import { spawnCli } from "./spawn.js";
import { SessionStore } from "../account/store.js";
import { prepareResume } from "./inject/index.js";
import type { ApprovalChannel } from "./approval/channel.js";
import type {
  AgentRuntime,
  ChatMessage,
  SessionHandle,
  SessionMeta,
  StorageAdapter,
  Wallet,
} from "./contract.js";

// `approval` is the swappable decision source (webview buttons / auto / push). The
// surface passes one in; omit it and tool use auto-allows (safe local default).
export function createRuntime(
  wallet: Wallet,
  storage: StorageAdapter,
  approval?: ApprovalChannel,
): AgentRuntime {
  const store = new SessionStore(wallet, storage);

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

      // per-session approval channel (each panel passes its own) wins; fall back to
      // the runtime-level default channel.
      const cli = spawnCli({ ...opts, sessionId: nativeId, approval: opts.approval ?? approval });

      // Storage key stays the CANONICAL id while resuming; the cli's emitted (native)
      // id must NOT overwrite it, or appended turns land in the wrong log.
      let sessionId = opts.sessionId ?? ""; // canonical; "" until a fresh cli reveals it
      let title = "";
      const msgCbs: Array<(m: ChatMessage) => void> = [];
      const turnCbs: Array<() => void> = [];
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
      cli.onUsage((n: number) => { for (const cb of usageCbs) cb(n); });
      cli.onTurnEnd(() => {
        void flush().then(() => {
          for (const cb of turnCbs) cb();
        });
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
        onUsage(cb) {
          usageCbs.push(cb);
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
