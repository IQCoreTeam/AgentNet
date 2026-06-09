// AgentRuntime implementation — wires spawn + parse + append-on-the-fly.
// startSession() spawns the CLI, turns its output into ChatMessages (onMessage),
// and APPENDS each message to the encrypted log as it happens (no full rewrite).
// Messages seen before the real sessionId arrives are queued, then flushed once
// the CLI reveals its id. The UI just calls startSession + send + onMessage.

import { spawnCli } from "./spawn.js";
import { parseClaudeLine } from "./convert/claude.js";
import { parseCodexLine } from "./convert/codex.js";
import type { LineParser } from "./convert/types.js";
import { SessionStore } from "../account/store.js";
import { prepareResume } from "./inject/index.js";
import type {
  AgentRuntime,
  ChatMessage,
  SessionHandle,
  SessionMeta,
  StorageAdapter,
  Wallet,
} from "./contract.js";

export function createRuntime(wallet: Wallet, storage: StorageAdapter): AgentRuntime {
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

      const cli = spawnCli({ ...opts, sessionId: nativeId });
      const parse: LineParser = opts.cli === "claude" ? parseClaudeLine : parseCodexLine;

      // Storage key stays the CANONICAL id while resuming; the cli's emitted (native)
      // id must NOT overwrite it, or appended turns land in the wrong log.
      let sessionId = opts.sessionId ?? ""; // canonical; "" until a fresh cli reveals it
      let title = "";
      const msgCbs: Array<(m: ChatMessage) => void> = [];
      const turnCbs: Array<() => void> = [];
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

      cli.lines.on("line", (line: string) => {
        const r = parse(line);
        // Only a FRESH session adopts the cli's id as canonical. While resuming,
        // sessionId is already the canonical id and the native threadId is already
        // set in spawn (from nativeId), so we leave both untouched.
        if (r.sessionId && !sessionId) {
          sessionId = r.sessionId;
          cli.setSessionId?.(r.sessionId); // codex: resume this thread next turn
          void flush();
        }
        for (const m of r.messages) emit(m);
        if (r.turnEnded) {
          void flush().then(() => {
            for (const cb of turnCbs) cb();
          });
        }
      });

      // Surface failures instead of going silent: a crash / nonzero exit used to be
      // swallowed (no "line", so the UI just waited forever). Show it as a tool
      // message and end the turn so the UI unblocks. codex exits per turn with code
      // 0 normally, so only a NONZERO exit is reported.
      let sawError = false;
      let stopped = false; // we asked it to stop (tab/model switch) → exit isn't an error
      let stderr = "";     // collected so a real failure can show WHY
      const fail = (text: string) => {
        if (sawError) return;
        sawError = true;
        emit({ role: "tool", text, ts: Date.now() });
        void flush().then(() => {
          for (const cb of turnCbs) cb();
        });
      };
      cli.lines.on("stderr", (s: string) => { stderr += s; });
      cli.lines.on("error", (err: Error) => fail(`[${opts.cli} failed to start] ${err.message}`));
      cli.lines.on("exit", (code: number | null, signal: string | null) => {
        // 143/SIGTERM etc. from our own stop() is expected — don't report it.
        if (stopped || signal === "SIGTERM" || signal === "SIGKILL") return;
        if (code && code !== 0) {
          const why = stderr.trim().split("\n").filter(Boolean).slice(-4).join("\n");
          fail(`[${opts.cli} exited with code ${code}]\n${why || "(no stderr)"}`);
        }
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
