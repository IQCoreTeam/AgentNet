import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { spawnCli } from "./spawn.js";
import { createRuntime } from "./index.js";
import { getNativeId } from "./inject/idmap.js";
import { SessionStore } from "../account/store.js";
import { manualStorage } from "../account/storage/manual.js";
import { testWallet } from "../account/keypairWallet.js";
import { codexSessionsDir } from "../core/paths.js";
import type { ApprovalRequest } from "./approval/channel.js";
import type { ChatMessage } from "./contract.js";

vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawn: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

// A codex app-server over the JSON-RPC boundary only: it rejects thread/resume for each
// of `deadThreads`, accepts everything else, and raises one command approval inside each
// turn so the id the approval carries can be checked against the thread the turn ran in.
function fakeCodex(...deadThreads: string[]) {
  const requests: { id: number; method: string; params: Record<string, any> }[] = [];
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const serve = (msg: object) => stdout.write(JSON.stringify(msg) + "\n");
  const child = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    stdin: new Writable({
      write(chunk, _encoding, done) {
        const msg = JSON.parse(chunk.toString());
        if (msg.method) {
          requests.push(msg);
          queueMicrotask(() => {
            if (msg.method === "thread/resume" && deadThreads.includes(msg.params.threadId)) {
              serve({ id: msg.id, error: { code: -32600, message: `thread ${msg.params.threadId} not found` } });
            } else if (msg.method === "turn/start") {
              serve({ id: msg.id, result: { turn: { id: "turn-1" } } });
              serve({
                id: "srv-1",
                method: "item/commandExecution/requestApproval",
                params: { threadId: msg.params.threadId, turnId: "turn-1", command: ["ls"], cwd: "/" },
              });
            } else {
              serve({ id: msg.id, result: { thread: { id: msg.params.threadId ?? "started-thread" } } });
            }
          });
        }
        done();
      },
    }),
    kill: () => {
      queueMicrotask(() => {
        stdout.end();
        stderr.end();
        child.emit("exit", 0, null);
      });
      return true;
    },
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  return requests;
}

function approvalSink(into: ApprovalRequest[]) {
  return { request: async (req: ApprovalRequest) => { into.push(req); return { outcome: "once" as const }; } };
}

describe("codex engine: rejected thread/resume", () => {
  it("recovers under the reinjected id and ends no turn before turn/start is written", async () => {
    const requests = fakeCodex("dead-thread");
    const approvals: ApprovalRequest[] = [];
    const reinject = vi.fn(async () => "fresh-thread");
    const engine = spawnCli({ cli: "codex", cwd: process.cwd(), sessionId: "dead-thread", reinject, approval: approvalSink(approvals) });
    const sids: string[] = [];
    const messages: ChatMessage[] = [];
    const turnEnd = vi.fn();
    const errors = vi.fn();
    engine.onSessionId((id) => sids.push(id));
    engine.onMessage((m) => messages.push(m));
    engine.onTurnEnd(turnEnd);
    engine.onError(errors);
    try {
      engine.send("hello again");
      await vi.waitFor(() => expect(requests.map((r) => r.method)).toContain("turn/start"));
      expect(turnEnd).not.toHaveBeenCalled();
      expect(errors).not.toHaveBeenCalled();
      expect(requests.map((r) => r.method)).toEqual(["initialize", "thread/resume", "thread/resume", "turn/start"]);
      expect(requests[1].params.threadId).toBe("dead-thread");
      expect(reinject).toHaveBeenCalledTimes(1);
      expect(requests[2].params.threadId).toBe("fresh-thread");
      expect(requests[3].params.threadId).toBe("fresh-thread");
      expect(sids).toEqual(["fresh-thread"]);
      expect(messages).toEqual([
        expect.objectContaining({ role: "tool", text: "[codex] previous thread unavailable, continuing in a new one" }),
      ]);
      await vi.waitFor(() => expect(approvals).toHaveLength(1));
      expect(approvals[0].sessionId).toBe("fresh-thread");
    } finally {
      engine.stop();
    }
  });

  it("opens an empty thread when the reinjected id is rejected too, still ending no turn", async () => {
    const requests = fakeCodex("dead-thread", "fresh-thread");
    const reinject = vi.fn(async () => "fresh-thread");
    const engine = spawnCli({ cli: "codex", cwd: process.cwd(), sessionId: "dead-thread", reinject });
    const sids: string[] = [];
    const turnEnd = vi.fn();
    const errors = vi.fn();
    engine.onSessionId((id) => sids.push(id));
    engine.onTurnEnd(turnEnd);
    engine.onError(errors);
    try {
      engine.send("hello again");
      await vi.waitFor(() => expect(requests.map((r) => r.method)).toContain("turn/start"));
      expect(turnEnd).not.toHaveBeenCalled();
      expect(errors).not.toHaveBeenCalled();
      expect(requests.map((r) => r.method)).toEqual(["initialize", "thread/resume", "thread/resume", "thread/start", "turn/start"]);
      expect(requests[2].params.threadId).toBe("fresh-thread");
      expect(requests[4].params.threadId).toBe("started-thread");
      expect(sids).toEqual(["started-thread"]);
    } finally {
      engine.stop();
    }
  });

  it("opens an empty thread when no reinject hook is given", async () => {
    const requests = fakeCodex("dead-thread");
    const engine = spawnCli({ cli: "codex", cwd: process.cwd(), sessionId: "dead-thread" });
    const sids: string[] = [];
    const turnEnd = vi.fn();
    engine.onSessionId((id) => sids.push(id));
    engine.onTurnEnd(turnEnd);
    try {
      await vi.waitFor(() => expect(sids).toEqual(["started-thread"]));
      expect(requests.map((r) => r.method)).toEqual(["initialize", "thread/resume", "thread/start"]);
      expect(turnEnd).not.toHaveBeenCalled();
    } finally {
      engine.stop();
    }
  });
});

describe("runtime: codex resume fallback", () => {
  let home: string;
  const origEnv = { ...process.env };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "agentnet-resume-fallback-"));
    process.env.AGENTNET_HOME = join(home, "agentnet");
    process.env.CODEX_HOME = join(home, "codex");
    process.env.CLAUDE_CONFIG_DIR = join(home, "claude");
  });

  afterEach(() => {
    process.env = { ...origEnv };
    rmSync(home, { recursive: true, force: true });
  });

  // every rollout file under $CODEX_HOME/sessions whose name carries `threadId`
  const rolloutsFor = (threadId: string): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.includes(threadId)) out.push(p);
      }
    };
    walk(codexSessionsDir());
    return out;
  };

  it("replays the history under a recorded fresh id that later turns, approvals and respawns use", async () => {
    const wallet = testWallet();
    const storage = manualStorage();
    const store = new SessionStore(wallet, storage);
    const canonical = randomUUID();
    const meta = { sessionId: canonical, cli: "codex" as const, title: "sums", ts: Date.now() };
    await store.appendMessage(meta, { role: "user", text: "what is 2+2", ts: 1_700_000_000_000 });
    await store.appendMessage(meta, { role: "assistant", text: "4", ts: 1_700_000_001_000 });
    const cwd = join(home, "project");
    mkdirSync(cwd);

    const requests = fakeCodex(canonical);
    const approvals: ApprovalRequest[] = [];
    const runtime = createRuntime(wallet, storage, approvalSink(approvals));
    const handle = await runtime.startSession({ cli: "codex", cwd, sessionId: canonical });
    const turnEnd = vi.fn();
    handle.onTurnEnd(turnEnd);
    handle.send("and 3+3?");
    await vi.waitFor(() => expect(requests.map((r) => r.method)).toContain("turn/start"));
    expect(turnEnd).not.toHaveBeenCalled();
    expect(requests.map((r) => r.method)).toEqual(["initialize", "thread/resume", "thread/resume", "turn/start"]);
    expect(requests[1].params.threadId).toBe(canonical);
    const fresh = requests[2].params.threadId as string;
    expect(fresh).not.toBe(canonical);
    expect(requests[3].params.threadId).toBe(fresh);

    // the storage key stays canonical; the map records the recovered thread
    expect(handle.sessionId).toBe(canonical);
    expect(await getNativeId(canonical, "codex")).toBe(fresh);

    // the recovered thread carries the replayable history
    const rollouts = rolloutsFor(fresh);
    expect(rollouts).toHaveLength(1);
    const lines = readFileSync(rollouts[0], "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ type: "session_meta", payload: { id: fresh, cwd } });
    expect(lines.slice(1).map((l) => [l.payload.role, l.payload.content[0].text])).toEqual([
      ["user", "what is 2+2"],
      ["assistant", "4"],
    ]);

    // the approval carries the canonical id the surfaces know, not the native thread id
    await vi.waitFor(() => expect(approvals).toHaveLength(1));
    expect(approvals[0].sessionId).toBe(canonical);
    handle.stop();

    // a respawn resumes the recorded thread directly: no second fallback, no second notice
    const again = fakeCodex(canonical);
    const h2 = await runtime.startSession({ cli: "codex", cwd, sessionId: canonical });
    await vi.waitFor(() => expect(again.map((r) => r.method)).toEqual(["initialize", "thread/resume"]));
    expect(again[1].params.threadId).toBe(fresh);
    h2.stop();
    const notices = (await store.load(canonical))!.messages.filter((m) => m.role === "tool");
    expect(notices.map((m) => m.text)).toEqual(["[codex] previous thread unavailable, continuing in a new one"]);
  });
});
