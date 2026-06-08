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
      const cli = spawnCli(opts);
      const parse: LineParser = opts.cli === "claude" ? parseClaudeLine : parseCodexLine;

      let sessionId = opts.sessionId ?? ""; // "" until the CLI reveals its id
      let title = "";
      const msgCbs: Array<(m: ChatMessage) => void> = [];
      const turnCbs: Array<() => void> = [];
      const pending: ChatMessage[] = []; // messages awaiting a known sessionId

      const meta = () => ({ sessionId, cli: opts.cli, title, ts: Date.now() });

      // Show the message to the UI, then append it to the encrypted log.
      // Before sessionId is known, queue; flush() drains the queue once it is.
      const emit = (m: ChatMessage) => {
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
          cli.stop();
        },
      };
    },

    async listSessions(): Promise<SessionMeta[]> {
      return store.listMine();
    },

    async loadSession(sessionId: string): Promise<ChatMessage[]> {
      const s = await store.load(sessionId);
      return s?.messages ?? [];
    },

    async deleteSession(sessionId: string): Promise<void> {
      await store.remove(sessionId);
    },
  };
}
