// Spawn an agent CLI and expose its output as line events + a send()/stop().
// claude and codex have DIFFERENT process models, so each gets its own adapter
// behind one SpawnedCli interface:
//   claude — one long-lived process; stdin takes stream-json user messages.
//   codex  — one `exec` process PER turn; resume by thread id for later turns.

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";

export interface SpawnedCli {
  lines: EventEmitter; // "line" (string), "close", "stderr", "error", "exit"
  send(text: string): void; // send a user message (per-CLI semantics)
  stop(): void;
  // codex needs to know its thread id (parsed from output) to resume; runtime
  // sets this after seeing the first sessionId. claude ignores it.
  setSessionId?(id: string): void;
}

export interface SpawnOpts {
  cli: "claude" | "codex";
  cwd: string;
  // The NATIVE resume id for this cli (claude uuid / codex threadId), NOT the
  // canonical id. runtime/index.ts resolves it via inject/prepareResume first.
  sessionId?: string;
  model?: string;
}

export function spawnCli(opts: SpawnOpts): SpawnedCli {
  return opts.cli === "claude" ? spawnClaude(opts) : spawnCodex(opts);
}

// ── claude: long-lived stream-json process ───────────────
function spawnClaude(opts: SpawnOpts): SpawnedCli {
  const args = ["--output-format", "stream-json", "--input-format", "stream-json", "--verbose"];
  if (opts.model) args.push("--model", opts.model);
  // --resume <id> continues an existing conversation; --session-id starts a NEW
  // conversation pinned to that id. Use resume when we have a prior session.
  if (opts.sessionId) args.push("--resume", opts.sessionId);

  const proc = spawn("claude", args, {
    cwd: opts.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, TERM: "xterm-256color" },
  });

  const lines = pipeLines(proc);

  return {
    lines,
    send(text: string) {
      const payload = JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "text", text }] },
      });
      proc.stdin?.write(payload + "\n");
    },
    stop() {
      proc.kill();
    },
  };
}

// ── codex: one `exec` per turn, resume by thread id ──────
function spawnCodex(opts: SpawnOpts): SpawnedCli {
  const lines = new EventEmitter();
  let threadId = opts.sessionId; // resume target for the next turn
  let current: ChildProcess | undefined;

  const runTurn = (prompt: string) => {
    const base = ["exec", "--json", "--skip-git-repo-check"];
    if (opts.model) base.push("--model", opts.model);
    // resume existing thread, else start a fresh exec
    const args = threadId
      ? ["exec", "resume", threadId, "--json", "--skip-git-repo-check", prompt]
      : [...base, prompt];

    const proc = spawn("codex", args, {
      cwd: opts.cwd,
      // codex exec still probes stdin ("Reading additional input from stdin...");
      // give it a real (empty) pipe and close it so it gets a clean EOF instead of
      // hanging/erroring on an ignored fd (which exits 1 in some environments).
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    proc.stdin?.end(); // signal "no stdin input" right away
    current = proc;

    const rl = createInterface({ input: proc.stdout! });
    rl.on("line", (line) => lines.emit("line", line));
    proc.stderr?.on("data", (d: Buffer) => lines.emit("stderr", d.toString()));
    proc.on("error", (err) => lines.emit("error", err));
    proc.on("exit", (code, signal) => lines.emit("exit", code, signal));
  };

  return {
    lines,
    send(text: string) {
      runTurn(text);
    },
    stop() {
      current?.kill();
    },
    setSessionId(id: string) {
      threadId = id; // next send() will `exec resume <id>`
    },
  };
}

// shared: turn a process' stdout into "line" events on an emitter
function pipeLines(proc: ChildProcess): EventEmitter {
  const lines = new EventEmitter();
  const rl = createInterface({ input: proc.stdout! });
  rl.on("line", (line) => lines.emit("line", line));
  rl.on("close", () => lines.emit("close"));
  proc.stderr?.on("data", (d: Buffer) => lines.emit("stderr", d.toString()));
  proc.on("error", (err) => lines.emit("error", err));
  proc.on("exit", (code, signal) => lines.emit("exit", code, signal));
  return lines;
}
