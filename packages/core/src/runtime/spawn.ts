// Spawn an agent ENGINE and expose its output as ChatMessage events + send/stop.
// We now drive both CLIs through their official SDKs (claude → @anthropic-ai/
// claude-agent-sdk, codex → @openai/codex-sdk) instead of hand-spawning the binary
// and parsing stdout. The SDKs still spawn the same CLI under the hood and use the
// same on-disk session jsonl, so our cross-CLI inject (inject/*) is unchanged — but
// we now get a real permission gate: claude's canUseTool, routed to an ApprovalChannel.
//
// Each engine implements ONE interface (Engine) so the runtime treats both uniformly
// and never imports an SDK type. Output is delivered as already-mapped ChatMessages
// (convert/* map the SDK events); the runtime just appends + paints.

import { execFileSync, spawn } from "node:child_process";
import readline from "node:readline";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { configFile, rootDir } from "../core/paths.js";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { Codex } from "@openai/codex-sdk";
import type { ChatMessage } from "./contract.js";
import { mapClaudeMessage } from "./convert/claude.js";
import { mapCodexEvent } from "./convert/codex.js";
import type { ApprovalChannel, ApprovalRequest } from "./approval/channel.js";
import { autoApprove } from "./approval/channel.js";

// Loosely-typed view of AskUserQuestion's raw input (the SDK hands us `unknown`-ish data).
type ApprovalQuestionInput = {
  question?: unknown;
  header?: unknown;
  multiSelect?: unknown;
  options?: { label?: unknown; description?: unknown }[];
};

// The SDK bundles its own native CLI binary, but when we BUNDLE the extension the
// SDK can't resolve that binary's path (it's outside the bundle) → "Native CLI binary
// not found". The fix: point the SDK at the user's installed `claude` (which they're
// already logged into). Resolve it once from PATH via `which`/`where`.
const exeCache = new Map<string, string | null>();
function resolveExecutable(name: string): string | undefined {
  if (!exeCache.has(name)) {
    try {
      const cmd = process.platform === "win32" ? "where" : "which";
      const out = execFileSync(cmd, [name], { encoding: "utf8" }).split("\n")[0]?.trim();
      exeCache.set(name, out && existsSync(out) ? out : null);
    } catch {
      exeCache.set(name, null);
    }
  }
  return exeCache.get(name) ?? undefined;
}

// The runtime-facing engine handle. Callbacks are registered once; send() feeds a
// user turn; stop() ends the session. sessionId(cb) fires when the engine reveals
// its native id (so the runtime can adopt it for a fresh session).
export interface Engine {
  onMessage(cb: (m: ChatMessage) => void): void;
  onSessionId(cb: (id: string) => void): void;
  onTurnEnd(cb: () => void): void;
  onError(cb: (text: string) => void): void;
  onUsage(cb: (contextTokens: number) => void): void; // real context occupancy per turn
  send(text: string): void;
  stop(): void;
}

export interface SpawnOpts {
  cli: "claude" | "codex";
  cwd: string;
  sessionId?: string; // NATIVE resume id (inject/prepareResume resolved it already)
  model?: string;
  approval?: ApprovalChannel; // how tool approvals get decided; default = auto-allow
  stream?: boolean; // emit partial assistant deltas (claude includePartialMessages)
  apiKey?: string; // Stage 1 Codex API Key
  ephemeral?: boolean; // If true, disable tools / auto-deny approvals
}

export function spawnCli(opts: SpawnOpts): Engine {
  return opts.cli === "claude" ? claudeEngine(opts) : codexEngine(opts);
}

// small typed callback bag so each engine doesn't re-implement listener plumbing.
function callbacks() {
  const msg: Array<(m: ChatMessage) => void> = [];
  const sid: Array<(id: string) => void> = [];
  const turn: Array<() => void> = [];
  const err: Array<(t: string) => void> = [];
  const use: Array<(n: number) => void> = [];
  return {
    msg, sid, turn, err, use,
    emitMsg: (m: ChatMessage) => { for (const c of msg) c(m); },
    emitSid: (id: string) => { for (const c of sid) c(id); },
    emitTurn: () => { for (const c of turn) c(); },
    emitErr: (t: string) => { for (const c of err) c(t); },
    emitUsage: (n: number) => { for (const c of use) c(n); },
  };
}

function loadPersistentWhitelist(): Set<string> {
  try {
    const file = configFile();
    if (!existsSync(file)) return new Set();
    const data = JSON.parse(readFileSync(file, "utf8"));
    return new Set(Array.isArray(data.whitelist) ? data.whitelist : []);
  } catch {
    return new Set();
  }
}

function savePersistentWhitelist(allowedKeys: Set<string>): void {
  try {
    const file = configFile();
    const rDir = rootDir();
    if (!existsSync(rDir)) {
      mkdirSync(rDir, { recursive: true });
    }
    let config: any = {};
    if (existsSync(file)) {
      config = JSON.parse(readFileSync(file, "utf8"));
    }
    config.whitelist = Array.from(allowedKeys);
    writeFileSync(file, JSON.stringify(config, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save whitelist:", e);
  }
}

// ── claude: SDK query with streaming input + canUseTool → ApprovalChannel ─────
function claudeEngine(opts: SpawnOpts): Engine {
  const cb = callbacks();
  const approval = opts.approval ?? autoApprove();
  let sessionId = opts.sessionId ?? "";

  // streaming input: an async queue the SDK pulls user turns from. send() pushes;
  // the generator yields them. This keeps ONE query() alive across many turns.
  const inbox: string[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  async function* prompts(): AsyncGenerator<import("@anthropic-ai/claude-agent-sdk").SDKUserMessage> {
    while (!closed) {
      if (inbox.length === 0) await new Promise<void>((r) => (wake = r));
      while (inbox.length) {
        const text = inbox.shift()!;
        yield { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null };
      }
    }
  }
  const push = (t: string) => { inbox.push(t); wake?.(); wake = null; };

  // Per-session memory of "always" grants. claude's SDK has no native allowlist across
  // canUseTool calls, so we keep one: a set of action keys the user has blanket-approved.
  // Read-only tools are auto-allowed up front (no prompt) — matching Claude Code's
  // default and killing the per-file-read approval spam.
  const allowed = loadPersistentWhitelist();
  const READONLY = new Set(["Read", "Glob", "Grep", "LS", "NotebookRead", "TodoWrite", "WebFetch", "WebSearch"]);
  const actionKey = (req: ApprovalRequest) =>
    req.kind === "bash" ? `bash:${req.command}` : `${req.tool}:${req.file || ""}`;

  // canUseTool: claude calls this BEFORE each tool; we translate to a neutral
  // ApprovalRequest, await the channel, and map the decision back to the SDK shape.
  const canUseTool = async (toolName: string, input: Record<string, unknown>) => {
    if (opts.ephemeral) {
      return { behavior: "deny" as const, message: "Tool use is disabled for side-channel (/btw) queries." };
    }
    if (READONLY.has(toolName)) return { behavior: "allow" as const, updatedInput: input };
    const req = toApprovalRequest("claude", sessionId, toolName, input, opts.cwd);
    const key = actionKey(req);
    if (allowed.has(key)) return { behavior: "allow" as const, updatedInput: input };
    const decision = await approval.request(req);
    if (decision.outcome === "deny") {
      return { behavior: "deny" as const, message: decision.reason ?? "Denied by user" };
    }
    if (decision.outcome === "always") {
      allowed.add(key); // remember for the rest of the session
      savePersistentWhitelist(allowed);
    }
    // AskUserQuestion isn't a yes/no gate: the user's choice IS the tool result. The SDK
    // takes it via updatedInput.answers (question text → chosen label). We allow with that
    // input so claude continues with the answer, instead of trying to render its own
    // (headless, no-TTY) picker and hanging.
    if (toolName === "AskUserQuestion" && decision.answers) {
      return {
        behavior: "allow" as const,
        updatedInput: { questions: input.questions, answers: decision.answers },
      };
    }
    return { behavior: "allow" as const, updatedInput: decision.updatedInput ?? input };
  };

  const q = query({
    prompt: prompts(),
    options: {
      resume: opts.sessionId || undefined,
      model: opts.model,
      cwd: opts.cwd,
      canUseTool,
      includePartialMessages: !!opts.stream,
      // keep claude's full coding system prompt, append an anti-laziness nudge: some
      // models reply "already done / file exists" on simple asks without acting. This
      // pushes them to verify-or-create with a tool instead of describing.
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append:
          "Never assume a file already exists or that a task is already done. " +
          "Verify with a tool (Read/Bash) or create it. Do the work with tools; do not just describe it.",
      },
      // use the user's installed claude (logged in) so the bundled extension doesn't
      // need the SDK's own native binary on its (unresolvable) bundle-relative path.
      pathToClaudeCodeExecutable: resolveExecutable("claude"),
      stderr: (d: string) => { if (d.trim()) cb.emitErr(`[claude] ${d.trim()}`); },
    },
  });

  // drive the output generator; map each SDKMessage → ChatMessages. Partial assistant
  // deltas are ACCUMULATED here into a running snapshot so the surface always receives
  // "full text so far" (replace-semantics) — matching codex's item.updated snapshots.
  (async () => {
    let streamBuf = "";
    try {
      for await (const m of q) {
        const r = mapClaudeMessage(m);
        if (r.sessionId && !sessionId) { sessionId = r.sessionId; cb.emitSid(r.sessionId); }
        for (const cm of r.messages) {
          if (cm.role === "assistant" && cm.partial) {
            streamBuf += cm.text;
            cb.emitMsg({ ...cm, text: streamBuf });
          } else {
            if (cm.role === "assistant" && !cm.partial) streamBuf = ""; // final block arrived
            cb.emitMsg(cm);
          }
        }
        if (r.contextTokens !== undefined) cb.emitUsage(r.contextTokens);
        if (r.turnEnded) { streamBuf = ""; cb.emitTurn(); }
      }
    } catch (e) {
      cb.emitErr(`[claude engine] ${e instanceof Error ? e.message : String(e)}`);
      cb.emitTurn();
    }
  })();

  return {
    onMessage: (c) => cb.msg.push(c),
    onSessionId: (c) => cb.sid.push(c),
    onTurnEnd: (c) => cb.turn.push(c),
    onError: (c) => cb.err.push(c),
    onUsage: (c) => cb.use.push(c),
    send: (t) => push(t),
    stop: () => { closed = true; wake?.(); void q.interrupt?.().catch(() => {}); },
  };
}

// ── codex: app-server JSON-RPC over stdio. Spawns `codex app-server --stdio`
// and processes requests and notifications, routing approvals to the ApprovalChannel.
function codexEngine(opts: SpawnOpts): Engine {
  const cb = callbacks();
  const approval = opts.approval ?? autoApprove();

  const codexPath = resolveExecutable("codex") || "codex";
  const childEnv = { ...process.env };
  if (opts.apiKey) {
    childEnv.OPENAI_API_KEY = opts.apiKey;
  }
  const child = spawn(codexPath, ["app-server", "--stdio"], {
    env: childEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.stderr.on("data", (d) => {
    const text = d.toString().trim();
    if (text) {
      cb.emitErr(`[codex app-server stderr] ${text}`);
    }
  });

  child.on("error", (err) => {
    cb.emitErr(`[codex app-server] Failed to start: ${err.message}`);
    cb.emitTurn();
  });
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      cb.emitErr(`[codex app-server] Exited with code ${code}`);
      cb.emitTurn();
    }
  });

  let nextRpcId = 1;
  const pendingRequests = new Map<number | string, { resolve: (res: any) => void; reject: (err: any) => void }>();

  function sendRequest(method: string, params: any): Promise<any> {
    const id = nextRpcId++;
    const msg = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify(msg) + "\n");
    });
  }

  function sendResponse(id: number | string, result: any) {
    const msg = { jsonrpc: "2.0", id, result };
    child.stdin.write(JSON.stringify(msg) + "\n");
  }

  function sendError(id: number | string, error: any) {
    const msg = { jsonrpc: "2.0", id, error };
    child.stdin.write(JSON.stringify(msg) + "\n");
  }

  const rl = readline.createInterface({
    input: child.stdout,
    terminal: false,
  });

  let sessionId = opts.sessionId ?? "";
  let streamBuf = "";
  let thinkingBuf = "";
  let running = false;

  rl.on("line", (line) => {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && msg.method !== undefined) {
        handleServerRequest(msg);
      } else if (msg.id !== undefined) {
        const pending = pendingRequests.get(msg.id);
        if (pending) {
          pendingRequests.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(msg.error.message || "RPC Error"));
          } else {
            pending.resolve(msg.result);
          }
        }
      } else {
        handleServerNotification(msg);
      }
    } catch (e) {
      console.error("Failed to parse JSON-RPC line:", line, e);
    }
  });

  function handleServerNotification(msg: any) {
    const params = msg.params;
    if (msg.method === "thread/started" && params?.threadId) {
      sessionId = params.threadId;
      cb.emitSid(params.threadId);
    } else if (msg.method === "item/agentMessage/delta" && params?.delta) {
      streamBuf += params.delta;
      cb.emitMsg({ role: "assistant", text: streamBuf, ts: Date.now(), partial: true });
    } else if (msg.method === "item/reasoning/textDelta" && params?.delta) {
      thinkingBuf += params.delta;
      cb.emitMsg({ role: "thinking", text: thinkingBuf, ts: Date.now(), partial: true });
    } else if (msg.method === "item/completed" && params?.item) {
      const it = params.item;
      if ((it.type === "agentMessage" || it.type === "agent_message") && it.text) {
        cb.emitMsg({ role: "assistant", text: it.text, ts: Date.now() });
        streamBuf = "";
      } else if (it.type === "reasoning") {
        const text = Array.isArray(it.content) ? it.content.join("\n") : (it.text || "");
        if (text) {
          cb.emitMsg({ role: "thinking", text, ts: Date.now() });
          thinkingBuf = "";
        }
      } else if ((it.type === "commandExecution" || it.type === "command_execution") && it.command) {
        const aggregatedOutput = it.aggregatedOutput !== undefined ? it.aggregatedOutput : it.aggregated_output;
        const exitCode = it.exitCode !== undefined ? it.exitCode : it.exit_code;
        cb.emitMsg({
          role: "tool",
          text: it.command.split("\n")[0]?.slice(0, 80) || "bash",
          ts: Date.now(),
          tool: { name: "Bash", command: it.command, output: (aggregatedOutput ?? "").slice(0, 4000), exitCode },
        });
      } else if ((it.type === "fileChange" || it.type === "file_change") && Array.isArray(it.changes)) {
        for (const c of it.changes) {
          cb.emitMsg({
            role: "tool",
            text: c.kind + " " + (c.path.split("/").pop() || c.path),
            ts: Date.now(),
            tool: { name: c.kind === "delete" ? "Delete" : "Write", file: c.path },
          });
        }
      }
    } else if (msg.method === "rawResponseItem/completed" && params?.item) {
      const it = params.item;
      if (it.type === "message" && it.role === "assistant" && Array.isArray(it.content)) {
        const text = it.content
          .filter((c: any) => c.type === "output_text" || c.type === "input_text")
          .map((c: any) => c.text)
          .join("");
        if (text) {
          cb.emitMsg({ role: "assistant", text, ts: Date.now() });
          streamBuf = "";
        }
      } else if (it.type === "reasoning" && Array.isArray(it.content)) {
        const text = it.content
          .filter((c: any) => c.type === "reasoning_text" || c.type === "text")
          .map((c: any) => c.text)
          .join("");
        if (text) {
          cb.emitMsg({ role: "thinking", text, ts: Date.now() });
          thinkingBuf = "";
        }
      }
    } else if (msg.method === "turn/completed") {
      if (params?.usage) {
        const usage = params.usage;
        cb.emitUsage((usage.input_tokens ?? 0) + (usage.cached_input_tokens ?? 0));
      }
      cb.emitTurn();
      running = false;
    } else if (msg.method === "turn/failed" || msg.method === "error") {
      const err = params?.error?.message || params?.message || "Turn failed";
      cb.emitErr(`[codex] ${err}`);
      cb.emitTurn();
      running = false;
    }
  }

  async function handleServerRequest(msg: any) {
    const params = msg.params;
    try {
      if (opts.ephemeral) {
        if (msg.method === "execCommandApproval" || msg.method === "item/commandExecution/requestApproval") {
          const decision = msg.method === "execCommandApproval" ? "denied" : "decline";
          sendResponse(msg.id, { decision });
        } else if (msg.method === "applyPatchApproval" || msg.method === "item/fileChange/requestApproval") {
          const decision = msg.method === "applyPatchApproval" ? "denied" : "decline";
          sendResponse(msg.id, { decision });
        } else if (msg.method === "item/permissions/requestApproval") {
          sendError(msg.id, { code: 4001, message: "User declined permissions request in side-channel mode." });
        } else {
          sendError(msg.id, { code: -32601, message: `Method '${msg.method}' not allowed in side-channel mode` });
        }
        return;
      }
      if (msg.method === "execCommandApproval" || msg.method === "item/commandExecution/requestApproval") {
        let cmdStr = "";
        if (params.command) {
          cmdStr = Array.isArray(params.command) ? params.command.join(" ") : String(params.command);
        }
        const req = toApprovalRequest("codex", sessionId, "Bash", { command: cmdStr }, params.cwd);
        const key = `bash:${cmdStr}`;
        const allowed = loadPersistentWhitelist();
        if (allowed.has(key)) {
          if (msg.method === "execCommandApproval") {
            return sendResponse(msg.id, { decision: "approved_for_session" });
          } else {
            return sendResponse(msg.id, { decision: "acceptForSession" });
          }
        }
        
        const decision = await approval.request(req);
        
        if (msg.method === "execCommandApproval") {
          let reviewDecision: string = "denied";
          if (decision.outcome === "once") reviewDecision = "approved";
          else if (decision.outcome === "always") {
            reviewDecision = "approved_for_session";
            allowed.add(key);
            savePersistentWhitelist(allowed);
          }
          else if (decision.outcome === "deny") reviewDecision = "denied";
          sendResponse(msg.id, { decision: reviewDecision });
        } else {
          let decisionVal: "accept" | "acceptForSession" | "decline" | "cancel" = "decline";
          if (decision.outcome === "once") decisionVal = "accept";
          else if (decision.outcome === "always") {
            decisionVal = "acceptForSession";
            allowed.add(key);
            savePersistentWhitelist(allowed);
          }
          else if (decision.outcome === "deny") decisionVal = "decline";
          sendResponse(msg.id, { decision: decisionVal });
        }
      } else if (msg.method === "applyPatchApproval" || msg.method === "item/fileChange/requestApproval") {
        if (msg.method === "applyPatchApproval") {
          const filePaths = Object.keys(params.fileChanges || {});
          const filePath = filePaths[0] || "";
          const change = filePath ? params.fileChanges[filePath] : null;
          let tool = "Write";
          let diff = "";
          if (change) {
            if (change.type === "add") {
              tool = "Write";
              diff = (change.content || "").split("\n").map((l: string) => "+" + l).join("\n");
            } else if (change.type === "delete") {
              tool = "Delete";
              diff = (change.content || "").split("\n").map((l: string) => "-" + l).join("\n");
            } else if (change.type === "update") {
              tool = "Edit";
              diff = change.unified_diff || "";
            }
          }
          
          const req = toApprovalRequest("codex", sessionId, tool, { file_path: filePath }, opts.cwd);
          if (diff) req.diff = diff;
          
          const key = `${tool}:${filePath}`;
          const allowed = loadPersistentWhitelist();
          if (allowed.has(key)) {
            return sendResponse(msg.id, { decision: "approved_for_session" });
          }
          
          const decision = await approval.request(req);
          let reviewDecision: string = "denied";
          if (decision.outcome === "once") reviewDecision = "approved";
          else if (decision.outcome === "always") {
            reviewDecision = "approved_for_session";
            allowed.add(key);
            savePersistentWhitelist(allowed);
          }
          else if (decision.outcome === "deny") reviewDecision = "denied";
          
          sendResponse(msg.id, { decision: reviewDecision });
        } else {
          const pathStr = params.grantRoot || "";
          const req = toApprovalRequest("codex", sessionId, "Edit", { file_path: pathStr }, opts.cwd);
          req.title = `Allow file changes under ${pathStr || "workspace"}`;
          if (params.reason) {
            req.title += ` (${params.reason})`;
          }
          
          const key = `Edit:${pathStr}`;
          const allowed = loadPersistentWhitelist();
          if (allowed.has(key)) {
            return sendResponse(msg.id, { decision: "acceptForSession" });
          }
          
          const decision = await approval.request(req);
          let decisionVal: "accept" | "acceptForSession" | "decline" | "cancel" = "decline";
          if (decision.outcome === "once") decisionVal = "accept";
          else if (decision.outcome === "always") {
            decisionVal = "acceptForSession";
            allowed.add(key);
            savePersistentWhitelist(allowed);
          }
          else if (decision.outcome === "deny") decisionVal = "decline";
          
          sendResponse(msg.id, { decision: decisionVal });
        }
      } else if (msg.method === "item/permissions/requestApproval") {
        const req = toApprovalRequest("codex", sessionId, "Permissions", { reason: params.reason }, opts.cwd);
        req.title = `Grant permissions: ${params.reason || "sandbox access"}`;
        
        const decision = await approval.request(req);
        if (decision.outcome === "deny") {
          sendError(msg.id, { code: 4001, message: "User declined permissions request" });
        } else {
          const permissions: any = {};
          if (params.permissions?.network) {
            permissions.network = params.permissions.network;
          }
          if (params.permissions?.fileSystem) {
            permissions.fileSystem = params.permissions.fileSystem;
          }
          sendResponse(msg.id, {
            permissions,
            scope: decision.outcome === "always" ? "session" : "turn",
          });
        }
      } else {
        sendError(msg.id, { code: -32601, message: `Method '${msg.method}' not implemented` });
      }
    } catch (e: any) {
      sendError(msg.id, { code: -32000, message: e.message || "Approval handling failed" });
    }
  }

  const initPromise = (async () => {
    try {
      await sendRequest("initialize", {
        clientInfo: { name: "AgentNet", title: "AgentNet VSCode", version: "0.1.0" },
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      
      if (opts.sessionId) {
        await sendRequest("thread/resume", {
          threadId: opts.sessionId,
          model: opts.model,
          cwd: opts.cwd,
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
        });
        cb.emitSid(opts.sessionId);
      } else {
        const res = await sendRequest("thread/start", {
          model: opts.model,
          cwd: opts.cwd,
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
        });
        const threadId = res?.thread?.id;
        if (threadId) {
          sessionId = threadId;
          cb.emitSid(threadId);
        }
      }
    } catch (e: any) {
      cb.emitErr(`[codex init] ${e.message}`);
      cb.emitTurn();
    }
  })();

  const runTurn = async (text: string) => {
    if (running) return;
    running = true;
    try {
      await sendRequest("turn/start", {
        threadId: sessionId,
        input: [{ type: "text", text, text_elements: [] }],
      });
    } catch (e) {
      cb.emitErr(`[codex engine] ${e instanceof Error ? e.message : String(e)}`);
      cb.emitTurn();
      running = false;
    }
  };

  return {
    onMessage: (c) => cb.msg.push(c),
    onSessionId: (c) => cb.sid.push(c),
    onTurnEnd: (c) => cb.turn.push(c),
    onError: (c) => cb.err.push(c),
    onUsage: (c) => cb.use.push(c),
    send: (t) => {
      void initPromise.then(() => runTurn(t));
    },
    stop: () => {
      child.kill();
    },
  };
}

// Build a neutral ApprovalRequest from a raw tool name + input (claude tools, or a
// codex turn). `kind`/fields let a surface render a good card without re-parsing.
function toApprovalRequest(
  cli: "claude" | "codex",
  sessionId: string,
  tool: string,
  input: Record<string, unknown>,
  cwd?: string,
): ApprovalRequest {
  const id = randomId();
  const file = strOr(input.file_path);
  // AskUserQuestion: surface the questions + options so the UI can render a choice list.
  if (tool === "AskUserQuestion" && Array.isArray(input.questions)) {
    const questions = (input.questions as ApprovalQuestionInput[]).map((q) => ({
      question: strOr(q.question),
      header: typeof q.header === "string" ? q.header : undefined,
      multiSelect: q.multiSelect === true,
      options: Array.isArray(q.options)
        ? q.options.map((o) => ({ label: strOr(o.label), description: typeof o.description === "string" ? o.description : undefined }))
        : [],
    }));
    const title = questions[0]?.question || "A question for you";
    return { id, cli, sessionId, tool, kind: "question", title, questions, input };
  }
  // ExitPlanMode: claude wants the plan approved before implementing.
  if (tool === "ExitPlanMode") {
    return { id, cli, sessionId, tool, kind: "plan", title: "Review the plan", plan: strOr(input.plan), input };
  }
  if (tool === "Bash") {
    const command = strOr(input.command);
    return {
      id, cli, sessionId, tool, kind: "bash", title: "Run: " + firstLine(command),
      command, cwd, risk: isDangerousCommand(command) ? "danger" : undefined, input,
    };
  }
  if (tool === "Edit" || tool === "MultiEdit") {
    return { id, cli, sessionId, tool, kind: "edit", title: "Edit " + baseName(file), file, diff: buildDiff(tool, input), input };
  }
  if (tool === "Write")
    return { id, cli, sessionId, tool, kind: "write", title: "Write " + baseName(file), file, diff: buildDiff(tool, input), input };
  if (tool === "Read") return { id, cli, sessionId, tool, kind: "read", title: "Read " + baseName(file), file, input };
  return { id, cli, sessionId, tool, kind: "other", title: tool, input };
}

// Build a +/- diff from the tool's raw input so the approval card shows WHAT changes,
// not just a filename. Edit = old→new; MultiEdit = each edit stacked; Write = whole
// file as additions. Best-effort: missing fields just yield an empty/partial diff.
function buildDiff(tool: string, input: Record<string, unknown>): string | undefined {
  if (tool === "Write") {
    const content = strOr(input.content);
    if (!content) return undefined;
    return content.split("\n").map((l) => "+" + l).join("\n");
  }
  if (tool === "MultiEdit") {
    const edits = Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : [];
    const blocks = edits.map((e) => pairDiff(strOr(e.old_string), strOr(e.new_string))).filter(Boolean);
    return blocks.length ? blocks.join("\n@@\n") : undefined;
  }
  // Edit
  const diff = pairDiff(strOr(input.old_string), strOr(input.new_string));
  return diff || undefined;
}

function pairDiff(oldStr: string, newStr: string): string {
  const out: string[] = [];
  if (oldStr) for (const l of oldStr.split("\n")) out.push("-" + l);
  if (newStr) for (const l of newStr.split("\n")) out.push("+" + l);
  return out.join("\n");
}

// Heuristic flag for destructive/irreversible shell actions. Not a security boundary —
// the user still decides — just a cue for the surface to alarm instead of stay calm.
const DANGER = [
  /\brm\s+(-[a-z]*r[a-z]*\s|-[a-z]*f[a-z]*\s|.*\s-[a-z]*[rf])/i, // rm -rf / -r / -f
  /\bsudo\b/, /\bchmod\s+-R\b/, /\bchown\s+-R\b/, /\bmkfs\b/, /\bdd\s+if=/,
  /\bgit\s+(push\s+.*--force|reset\s+--hard|clean\s+-[a-z]*f)/i,
  /\b(shutdown|reboot|halt)\b/, /:\(\)\s*\{.*\}/, // fork bomb
  /\b(curl|wget)\b.*\|\s*(sudo\s+)?(sh|bash|zsh)\b/, // pipe-to-shell
  />\s*\/dev\/sd[a-z]/, /\bkillall\b/, /\bnpm\s+publish\b/,
];
function isDangerousCommand(cmd: string): boolean {
  return !!cmd && DANGER.some((re) => re.test(cmd));
}

function randomId(): string { return "ap_" + Math.random().toString(36).slice(2, 11); }
function strOr(v: unknown): string { return typeof v === "string" ? v : ""; }
function firstLine(s: string): string { return (s.split("\n")[0] || "").slice(0, 80); }
function baseName(p: string): string { return p ? p.split("/").pop() || p : ""; }
