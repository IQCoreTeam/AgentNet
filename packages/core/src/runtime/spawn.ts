// Spawn an agent ENGINE and expose its output as ChatMessage events + send/stop.
// The two engines are driven differently, on purpose:
//   - claude → @anthropic-ai/claude-agent-sdk's query(), whose canUseTool callback
//     is routed to an ApprovalChannel for a real interactive permission gate.
//   - codex  → `codex app-server --stdio` JSON-RPC directly (NOT @openai/codex-sdk).
//     The SDK only exposes a coarse approvalPolicy with no inline approval callback;
//     app-server's protocol carries per-call approval requests (ExecCommandApproval,
//     ApplyPatchApproval, …) that we answer interactively — the same gate as claude.
// Both paths spawn the same codex/claude CLI under the hood and share the on-disk
// session jsonl + ~/.codex auth, so cross-CLI inject (inject/*) and login are unchanged.
//
// Each engine implements ONE interface (Engine) so the runtime treats both uniformly
// and never imports an SDK type. Output is delivered as already-mapped ChatMessages
// (convert/* map the SDK events); the runtime just appends + paints.

import { execFileSync, spawn } from "node:child_process";
import readline from "node:readline";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configFile, rootDir } from "../core/paths.js";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ChatMessage, ImageInput } from "./contract.js";
import { mapClaudeMessage } from "./convert/claude.js";
import { skillFromPath } from "./convert/codex.js";
import { codexFileChangeMessage } from "./convert/toolFormatting.js";
import type {
  ApprovalChannel,
  ApprovalDecision,
  ApprovalQuestion,
  ApprovalQuestionResponse,
  ApprovalRequest,
} from "./approval/channel.js";
import { autoApprove } from "./approval/channel.js";

// Loosely-typed view of AskUserQuestion's raw input (the SDK hands us `unknown`-ish data).
type ApprovalQuestionInput = {
  question?: unknown;
  header?: unknown;
  multiSelect?: unknown;
  options?: { label?: unknown; description?: unknown }[];
};

type CodexRequestUserInputQuestion = {
  id?: unknown;
  header?: unknown;
  question?: unknown;
  isOther?: unknown;
  isSecret?: unknown;
  options?: { label?: unknown; description?: unknown }[] | null;
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
  // a skill (an installed SKILL.md) just fired — name is the skill the model invoked.
  // Transient signal for the "Casting <skill>" activity marquee (issue #17); NOT a
  // transcript message (it isn't persisted).
  onSkill(cb: (name: string) => void): void;
  onUsage(cb: (contextTokens: number) => void): void; // real context occupancy per turn
  send(text: string, images?: ImageInput[]): void;
  runSlashCommand?(command: string, arg?: string): void;
  interrupt(): void; // stop the current turn, keep the session alive
  stop(): void;
  updateMode?(mode: string): void;
}

export interface SpawnOpts {
  cli: "claude" | "codex";
  cwd: string;
  sessionId?: string; // NATIVE resume id (inject/prepareResume resolved it already)
  model?: string;
  // permission/approval mode. claude → SDK permissionMode; codex → a sandbox+approval
  // preset key (readonly | auto | full). Omit → the engine's safe default.
  mode?: string;
  approval?: ApprovalChannel; // how tool approvals get decided; default = auto-allow
  // Passive skill-shopping (issue #21). Claude-only for now (Codex MCP via TOML deferred).
  // Built by the runtime per spawn when the toggle is ON: the marketplace SDK MCP server
  // + the tool ids to allow. (Skill awareness is a managed memory section now, not a
  // system-prompt append — so there's no appendSystemPrompt option anymore.)
  mcpServers?: Record<string, unknown>;
  allowedTools?: string[];
  // Codex MCP (Phase 1): codex app-server loads MCP servers from config, not an
  // in-process object — so it's spawned as a child process. We inject it via `-c
  // mcp_servers.<name>...` overrides on the app-server command (process-scoped; the
  // user's global ~/.codex/config.toml is untouched).
  codexMcp?: { name: string; command: string; args: string[] };
  stream?: boolean; // emit partial assistant deltas (claude includePartialMessages)
  apiKey?: string; // Stage 1 Codex API Key
  ephemeral?: boolean; // If true, disable tools / auto-deny approvals
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

// claude permission modes: how aggressively tools run without a per-call gate.
//   default        — canUseTool gates every tool (ask before edits/commands)
//   acceptEdits    — file edits auto-apply; other tools still gated
//   plan           — read-only until the model proposes a plan (ExitPlanMode)
//   bypassPermissions — nothing is gated (full auto)
function claudePermissionMode(
  mode?: string,
): "default" | "acceptEdits" | "plan" | "bypassPermissions" {
  return mode === "acceptEdits" || mode === "plan" || mode === "bypassPermissions"
    ? mode
    : "default";
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
  const skill: Array<(name: string) => void> = [];
  const use: Array<(n: number) => void> = [];
  return {
    msg, sid, turn, err, skill, use,
    emitMsg: (m: ChatMessage) => { for (const c of msg) c(m); },
    emitSid: (id: string) => { for (const c of sid) c(id); },
    emitTurn: () => { for (const c of turn) c(); },
    emitErr: (t: string) => { for (const c of err) c(t); },
    emitSkill: (n: string) => { for (const c of skill) c(n); },
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

// ── image attachments: each engine wants a different shape ───────────────────
const mimeToExt = (mime: string) =>
  mime === "image/jpeg" ? "jpg"
  : mime === "image/gif" ? "gif"
  : mime === "image/webp" ? "webp"
  : "png"; // default/png

// claude takes images INLINE as base64 content blocks alongside a text block. An empty
// text block is dropped (image-only turns are valid). Returns a plain string when there
// are no images, so the common path is unchanged. Exported for spawn.spec.
export function claudeUserContent(text: string, images?: ImageInput[]): string | unknown[] {
  if (!images || !images.length) return text;
  const blocks: unknown[] = [];
  if (text) blocks.push({ type: "text", text });
  for (const im of images) {
    blocks.push({ type: "image", source: { type: "base64", media_type: im.mime, data: im.dataBase64 } });
  }
  return blocks;
}

// codex needs a FILE PATH (its native `localImage` input), so we materialise each base64
// image into a temp file and hand back the paths + a cleanup to unlink them after the
// turn. Files live under <tmp>/agentnet-img; a failed write is skipped, not fatal.
function writeCodexImages(images: ImageInput[]): { paths: string[]; cleanup: () => void } {
  const dir = join(tmpdir(), "agentnet-img");
  try { mkdirSync(dir, { recursive: true }); } catch {}
  const paths: string[] = [];
  images.forEach((im, i) => {
    try {
      const p = join(dir, `img-${process.pid}-${seqImg++}-${i}.${mimeToExt(im.mime)}`);
      writeFileSync(p, Buffer.from(im.dataBase64, "base64"));
      paths.push(p);
    } catch (e) {
      console.error("[codex image] failed to write temp file:", e);
    }
  });
  return {
    paths,
    cleanup: () => { for (const p of paths) { try { unlinkSync(p); } catch {} } },
  };
}
let seqImg = 0; // monotonic so two images in one turn never collide on a filename

// ── claude: SDK query with streaming input + canUseTool → ApprovalChannel ─────
function claudeEngine(opts: SpawnOpts): Engine {
  const cb = callbacks();
  const approval = opts.approval ?? autoApprove();
  let sessionId = opts.sessionId ?? "";
  let currentMode = opts.mode;

  // streaming input: an async queue the SDK pulls user turns from. send() pushes;
  // the generator yields them. This keeps ONE query() alive across many turns.
  const inbox: { text: string; images?: ImageInput[] }[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  async function* prompts(): AsyncGenerator<import("@anthropic-ai/claude-agent-sdk").SDKUserMessage> {
    while (!closed) {
      if (inbox.length === 0) await new Promise<void>((r) => (wake = r));
      while (inbox.length) {
        const turn = inbox.shift()!;
        const content = claudeUserContent(turn.text, turn.images);
        yield { type: "user", message: { role: "user", content: content as any }, parent_tool_use_id: null };
      }
    }
  }
  const push = (text: string, images?: ImageInput[]) => { inbox.push({ text, images }); wake?.(); wake = null; };

  // Per-session memory of "always" grants. claude's SDK has no native allowlist across
  // canUseTool calls, so we keep one: a set of action keys the user has blanket-approved.
  // Read-only tools are auto-allowed up front (no prompt) — matching Claude Code's
  // default and killing the per-file-read approval spam.
  const allowed = loadPersistentWhitelist();
  const READONLY = new Set(["Read", "Glob", "Grep", "LS", "NotebookRead", "TodoWrite", "WebFetch", "WebSearch"]);
  const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write"]);
  const actionKey = (req: ApprovalRequest) =>
    req.kind === "bash" ? `bash:${req.command}` : `${req.tool}:${req.file || ""}`;

  // canUseTool: claude calls this BEFORE each tool; we translate to a neutral
  // ApprovalRequest, await the channel, and map the decision back to the SDK shape.
  const canUseTool = async (toolName: string, input: Record<string, unknown>) => {
    // NOTE: the "Skill" tool → "Casting <skill>" cue is emitted from the OUTPUT stream
    // (see firedSkillIds above), not here — canUseTool is skipped when a tool is
    // auto-allowed under acceptEdits/bypassPermissions, which would drop the cue.
    if (opts.ephemeral) {
      return { behavior: "deny" as const, message: "Tool use is disabled for side-channel (/btw) queries." };
    }
    if (READONLY.has(toolName)) return { behavior: "allow" as const, updatedInput: input };
    if (currentMode === "bypassPermissions") return { behavior: "allow" as const, updatedInput: input };
    if (currentMode === "acceptEdits" && EDIT_TOOLS.has(toolName)) {
      return { behavior: "allow" as const, updatedInput: input };
    }
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
    // AskUserQuestion isn't a yes/no gate: the user's answer IS the tool result. The SDK
    // takes it via updatedInput.answers / response, so we allow with that payload and
    // skip claude's own headless picker.
    const questionInput = buildClaudeQuestionInput(input.questions, decision);
    if (toolName === "AskUserQuestion" && questionInput) {
      return {
        behavior: "allow" as const,
        updatedInput: questionInput,
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
      permissionMode: claudePermissionMode(opts.mode),
      canUseTool,
      // Token-by-token streaming is ON by default (codex already streams unconditionally) so
      // claude renders incrementally like the official VSCode extension instead of sitting on
      // "…" until the whole turn lands. A surface can still disable it with stream:false.
      // Partials arrive as text deltas → accumulated into a cumulative snapshot below and
      // rendered with replace-semantics (no append), so there's no duplication.
      includePartialMessages: opts.stream !== false,
      effort: opts.effort,
      // Vanilla claude: use the stock claude_code system prompt with NOTHING appended.
      // We used to append an "anti-laziness" nudge here, but it made the agent feel
      // slightly off vs real claude (over-verifying, stiffer). Skill awareness now
      // lives in MEMORY (a managed "your skills" section), not in the system prompt —
      // so the prompt stays exactly what claude code ships with.
      systemPrompt: { type: "preset", preset: "claude_code" },
      // use the user's installed claude (logged in) so the bundled extension doesn't
      // need the SDK's own native binary on its (unresolvable) bundle-relative path.
      pathToClaudeCodeExecutable: resolveExecutable("claude"),
      stderr: (d: string) => { if (d.trim()) cb.emitErr(`[claude] ${d.trim()}`); },
      // Passive skill-shopping wiring (issue #21): the MCP marketplace server + its
      // allowed tools, when the toggle is ON. The "which skills you have" directive is
      // NOT injected here anymore — it's a managed memory section (skillsSection.ts).
      ...(opts.mcpServers ? { mcpServers: opts.mcpServers as never } : {}),
      ...(opts.allowedTools ? { allowedTools: opts.allowedTools } : {}),
      // NOTE: settingSources is deliberately omitted — the SDK then loads ALL sources
      // (user/project/local), which is what lets skills in the user dir (~/.claude/skills,
      // where owned NFTs + the passive workflow are installed) be discovered. Passing
      // settingSources:['project'] would DROP the user dir and break skill discovery.
    },
  });

  // drive the output generator; map each SDKMessage → ChatMessages. Partial assistant
  // deltas are ACCUMULATED here into a running snapshot so the surface always receives
  // "full text so far" (replace-semantics) — matching codex's item.updated snapshots.
  const firedSkillIds = new Set<string>();
  (async () => {
    let streamBuf = "";
    try {
      for await (const m of q) {
        // A skill firing surfaces as a `Skill` tool_use in the assistant stream. Detect it
        // HERE (not only in canUseTool, which is bypassed when the tool is auto-allowed under
        // acceptEdits/bypassPermissions) so the "Casting <skill>" cue fires whenever the agent
        // actually uses a skill. Deduped by the tool_use id.
        const am = m as any;
        if (am?.type === "assistant" && Array.isArray(am.message?.content)) {
          for (const b of am.message.content) {
            if (b?.type === "tool_use" && b.name === "Skill" && b.id && !firedSkillIds.has(b.id)) {
              firedSkillIds.add(b.id);
              const inp = b.input || {};
              const n = inp.command ?? inp.name ?? inp.skill;
              if (n) cb.emitSkill(String(n));
            }
          }
        }
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
    onSkill: (c) => cb.skill.push(c),
    onUsage: (c) => cb.use.push(c),
    send: (t, images) => push(t, images),
    runSlashCommand: (command, arg) => {
      const text = "/" + command + (arg ? " " + arg : "");
      push(text);
    },
    // interrupt the running turn WITHOUT closing the query — prompts() keeps waiting, so
    // the next send resumes the same session. (stop() also sets closed=true to end it.)
    interrupt: () => { void q.interrupt?.().catch(() => {}); },
    stop: () => { closed = true; wake?.(); void q.interrupt?.().catch(() => {}); },
    updateMode: (mode) => { currentMode = mode; },
  };
}

// Build `-c mcp_servers.<name>...` overrides for `codex app-server`. Values are TOML,
// so command/args are JSON-encoded (a JSON string is a valid TOML basic string; a JSON
// string array is a valid TOML array). Process-scoped — never touches ~/.codex/config.toml.
export function codexMcpFlags(m: { name: string; command: string; args: string[] }): string[] {
  return [
    "-c", `mcp_servers.${m.name}.command=${JSON.stringify(m.command)}`,
    "-c", `mcp_servers.${m.name}.args=${JSON.stringify(m.args)}`,
  ];
}

// ── codex: app-server JSON-RPC over stdio. Spawns `codex app-server --stdio`
// and processes requests and notifications, routing approvals to the ApprovalChannel.
function codexEngine(opts: SpawnOpts): Engine {
  const cb = callbacks();
  const approval = opts.approval ?? autoApprove();

  const codexPath = resolveExecutable("codex") || "codex";
  // Codex's OS-level sandbox uses bubblewrap, which can't run inside proot (no Linux
  // namespaces — that's why proot exists). On Android the launcher sets
  // AGENTNET_CODEX_SANDBOX=danger-full-access so Codex skips its own sandbox and relies on
  // proot + the app sandbox + our approval gate. Desktop leaves it unset → Codex's default.
  const sandbox = process.env.AGENTNET_CODEX_SANDBOX || undefined;
  const childEnv = { ...process.env };
  if (opts.apiKey) {
    childEnv.OPENAI_API_KEY = opts.apiKey;
  }
  const mcpFlags = opts.codexMcp ? codexMcpFlags(opts.codexMcp) : [];
  const child = spawn(codexPath, ["app-server", "--stdio", ...mcpFlags], {
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
  let currentTurnId: string | null = null; // the in-flight turn (for turn/interrupt)
  let pendingImgCleanup: (() => void) | null = null; // unlink this turn's temp images on end

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
    } else if (msg.method === "turn/started" && params?.turn?.id) {
      currentTurnId = params.turn.id; // remember so interrupt() can target THIS turn
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
        // codex has no per-tool hook, so a command touching our skills dir is the signal
        // that an installed skill is firing → the "Casting <skill>" cue (issue #17).
        const skillName = skillFromPath(it.command);
        if (skillName) cb.emitSkill(skillName);
        cb.emitMsg({
          role: "tool",
          text: it.command.split("\n")[0]?.slice(0, 80) || "bash",
          ts: Date.now(),
          tool: { name: "Bash", command: it.command, output: (aggregatedOutput ?? "").slice(0, 4000), exitCode },
        });
      } else if ((it.type === "fileChange" || it.type === "file_change") && Array.isArray(it.changes)) {
        for (const c of it.changes) {
          const msg = codexFileChangeMessage(c);
          if (msg) cb.emitMsg(msg);
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
      currentTurnId = null;
      streamBuf = ""; thinkingBuf = ""; // a turn that ended without a clean item/completed
      pendingImgCleanup?.(); pendingImgCleanup = null;
    } else if (msg.method === "turn/failed" || msg.method === "error") {
      const err = params?.error?.message || params?.message || "Turn failed";
      cb.emitErr(`[codex] ${err}`);
      cb.emitTurn();
      running = false;
      currentTurnId = null;
      streamBuf = ""; thinkingBuf = ""; // (e.g. interrupted) must not seed the next turn's snapshot
      pendingImgCleanup?.(); pendingImgCleanup = null;
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
      } else if (msg.method === "item/tool/requestUserInput") {
        const questions = toCodexApprovalQuestions(
          Array.isArray(params.questions) ? (params.questions as CodexRequestUserInputQuestion[]) : [],
        );
        const req: ApprovalRequest = {
          id: randomId(),
          cli: "codex",
          sessionId,
          tool: "request_user_input",
          kind: "question",
          title: questions[0]?.question || "Input needed",
          questions,
          input: { itemId: params.itemId, turnId: params.turnId },
        };
        const decision = await approval.request(req);
        if (decision.outcome === "deny") {
          sendError(msg.id, { code: 4001, message: decision.reason ?? "User declined input request" });
          return;
        }
        const response = buildCodexQuestionResponse(questions, decision);
        if (!response) {
          sendError(msg.id, { code: 4000, message: "Question response was incomplete" });
          return;
        }
        sendResponse(msg.id, response);
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
          ...(sandbox ? { sandbox } : {}),
          ...(opts.effort ? { reasoning_effort: opts.effort } : {}),
        });
        cb.emitSid(opts.sessionId);
      } else {
        const res = await sendRequest("thread/start", {
          model: opts.model,
          cwd: opts.cwd,
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          ...(sandbox ? { sandbox } : {}),
          ...(opts.effort ? { reasoning_effort: opts.effort } : {}),
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

  const runTurn = async (text: string, images?: ImageInput[]) => {
    if (running) return;
    running = true;
    // codex wants a file path per image (`localImage`), so materialise the base64 into
    // temp files for this turn and unlink them once it ends (turn/completed|failed|stop).
    const imgFiles = images && images.length ? writeCodexImages(images) : null;
    pendingImgCleanup = imgFiles?.cleanup ?? null;
    const input: any[] = [{ type: "text", text, text_elements: [] }];
    for (const p of imgFiles?.paths ?? []) input.push({ type: "localImage", path: p });
    try {
      await sendRequest("turn/start", { threadId: sessionId, input });
    } catch (e) {
      cb.emitErr(`[codex engine] ${e instanceof Error ? e.message : String(e)}`);
      cb.emitTurn();
      running = false;
      currentTurnId = null;
      pendingImgCleanup?.(); pendingImgCleanup = null;
    }
  };

  const runSlashCommand = async (command: string, arg?: string) => {
    try {
      await initPromise;
      if (command === "compact") {
        await sendRequest("thread/compact/start", { threadId: sessionId });
        cb.emitMsg({
          role: "summary",
          text: arg ? `context compacted: ${arg}` : "context compacted",
          ts: Date.now(),
        });
        cb.emitTurn();
        return;
      }
      if (command === "diff") {
        const res = await sendRequest("gitDiffToRemote", { cwd: opts.cwd });
        const diff = typeof res?.diff === "string" ? res.diff : "";
        cb.emitMsg({
          role: "tool",
          text: diff || "No working-tree changes.",
          ts: Date.now(),
          tool: { name: "Diff", command: "git diff", output: diff },
        });
        cb.emitTurn();
        return;
      }
      if (command === "review") {
        running = true;
        await sendRequest("review/start", {
          threadId: sessionId,
          target: arg ? { type: "custom", instructions: arg } : { type: "uncommittedChanges" },
          delivery: "inline",
        });
        return;
      }
      if (command === "mcp") {
        const res = await sendRequest("mcpServerStatus/list", {
          threadId: sessionId,
          limit: 50,
          detail: "toolsAndAuthOnly",
        });
        const servers = Array.isArray(res?.data) ? res.data : [];
        const text = servers.length
          ? servers.map((s: any) => {
              const tools = s?.tools && typeof s.tools === "object" ? Object.keys(s.tools).length : 0;
              const auth = typeof s?.authStatus === "string" ? s.authStatus : JSON.stringify(s?.authStatus ?? null);
              return `${s?.name ?? "(unnamed)"}: ${auth}, ${tools} tools`;
            }).join("\n")
          : "No MCP servers configured.";
        cb.emitMsg({
          role: "tool",
          text,
          ts: Date.now(),
          tool: { name: "MCP", command: "mcpServerStatus/list", output: text },
        });
        cb.emitTurn();
        return;
      }
      await runTurn("/" + command + (arg ? " " + arg : ""));
    } catch (e) {
      cb.emitErr(`[codex ${command}] ${e instanceof Error ? e.message : String(e)}`);
      cb.emitTurn();
    }
  };

  return {
    onMessage: (c) => cb.msg.push(c),
    onSessionId: (c) => cb.sid.push(c),
    onTurnEnd: (c) => cb.turn.push(c),
    onError: (c) => cb.err.push(c),
    // codex has no per-tool hook, so the skill signal comes from the output stream:
    // mapCodexEvent flags any command/path that references our skills dir (convert/codex).
    onSkill: (c) => cb.skill.push(c),
    onUsage: (c) => cb.use.push(c),
    send: (t, images) => {
      void initPromise.then(() => runTurn(t, images));
    },
    runSlashCommand: (command, arg) => {
      void runSlashCommand(command, arg);
    },
    // ask the server to abort the in-flight turn (keeps the thread alive). The resulting
    // turn/completed|failed unblocks the UI and clears running/turnId as usual.
    interrupt: () => {
      if (running && sessionId && currentTurnId) {
        void sendRequest("turn/interrupt", { threadId: sessionId, turnId: currentTurnId }).catch(() => {});
      }
    },
    stop: () => {
      pendingImgCleanup?.(); pendingImgCleanup = null;
      child.kill();
    },
    updateMode: (mode) => {},
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
    const questions = toClaudeApprovalQuestions(input.questions as ApprovalQuestionInput[]);
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

function toClaudeApprovalQuestions(input: ApprovalQuestionInput[]): ApprovalQuestion[] {
  return input.map((q) => ({
    question: strOr(q.question),
    header: typeof q.header === "string" ? q.header : undefined,
    multiSelect: q.multiSelect === true,
    allowCustomInput: true,
    secret: false,
    options: Array.isArray(q.options)
      ? q.options.map((o) => ({
          label: strOr(o.label),
          description: typeof o.description === "string" ? o.description : undefined,
        }))
      : [],
  }));
}

function toCodexApprovalQuestions(input: CodexRequestUserInputQuestion[]): ApprovalQuestion[] {
  return input.map((q) => {
    const options = Array.isArray(q.options)
      ? q.options.map((o) => ({
          label: strOr(o.label),
          description: strOr(o.description) || undefined,
        }))
      : [];
    return {
      id: strOr(q.id) || undefined,
      question: strOr(q.question),
      header: strOr(q.header) || undefined,
      multiSelect: false,
      // free-text when codex offers "Other", OR whenever there are no options — a question
      // with neither options nor a text field would be impossible to answer.
      allowCustomInput: q.isOther === true || options.length === 0,
      secret: q.isSecret === true,
      options,
    };
  });
}

function normalizeQuestionResponses(
  questions: ApprovalQuestion[],
  decision: ApprovalDecision,
): ApprovalQuestionResponse[] {
  const byId = new Map<string, ApprovalQuestionResponse>();
  const byQuestion = new Map<string, ApprovalQuestionResponse>();
  for (const raw of decision.questionResponses ?? []) {
    const normalized: ApprovalQuestionResponse = {
      question: raw.question,
      questionId: raw.questionId,
      selected: Array.isArray(raw.selected) ? raw.selected.filter(Boolean) : [],
      text: raw.text?.trim() || undefined,
    };
    if (normalized.questionId) byId.set(normalized.questionId, normalized);
    byQuestion.set(normalized.question, normalized);
  }

  return questions.map((q) => {
    const response = (q.id && byId.get(q.id)) || byQuestion.get(q.question);
    if (response) {
      return {
        question: q.question,
        questionId: q.id,
        selected: response.text ? [] : response.selected,
        text: response.text,
      };
    }
    const legacy = decision.answers?.[q.question]?.trim();
    return {
      question: q.question,
      questionId: q.id,
      selected: legacy ? legacy.split(",").map((v) => v.trim()).filter(Boolean) : [],
    };
  });
}

function questionResponseValue(response: ApprovalQuestionResponse): string {
  const typed = response.text?.trim();
  return typed && typed.length ? typed : response.selected.join(", ");
}

function buildClaudeQuestionInput(
  rawQuestions: unknown,
  decision: ApprovalDecision,
): Record<string, unknown> | null {
  if (!Array.isArray(rawQuestions)) return null;
  const questions = toClaudeApprovalQuestions(rawQuestions as ApprovalQuestionInput[]);
  const questionResponses = normalizeQuestionResponses(questions, decision);
  const answers = Object.fromEntries(
    questionResponses
      .map((response) => [response.question, questionResponseValue(response)] as const)
      .filter(([, value]) => value.length > 0),
  );
  if (Object.keys(answers).length === 0) return null;
  const typedResponses = questionResponses
    .map((response) => response.text?.trim())
    .filter((text): text is string => !!text);
  return {
    questions: rawQuestions,
    answers,
    ...(questions.length === 1 && typedResponses.length === 1 ? { response: typedResponses[0] } : {}),
  };
}

function buildCodexQuestionResponse(
  questions: ApprovalQuestion[],
  decision: ApprovalDecision,
): { answers: Record<string, { answers: string[] }> } | null {
  const questionResponses = normalizeQuestionResponses(questions, decision);
  const answers: Record<string, { answers: string[] }> = {};
  for (const response of questionResponses) {
    const key = response.questionId || response.question;
    const typed = response.text?.trim();
    const values = typed && typed.length ? [typed] : response.selected.filter(Boolean);
    if (!values.length) return null;
    answers[key] = { answers: values };
  }
  return Object.keys(answers).length ? { answers } : null;
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
