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

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
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
  // a skill (an installed SKILL.md) just fired — name is the skill the model invoked.
  // Transient signal for the "Casting <skill>" activity marquee (issue #17); NOT a
  // transcript message (it isn't persisted).
  onSkill(cb: (name: string) => void): void;
  send(text: string): void;
  stop(): void;
}

export interface SpawnOpts {
  cli: "claude" | "codex";
  cwd: string;
  sessionId?: string; // NATIVE resume id (inject/prepareResume resolved it already)
  model?: string;
  approval?: ApprovalChannel; // how tool approvals get decided; default = auto-allow
  // Passive skill-shopping (issue #21). Claude-only for now (Codex MCP via TOML deferred).
  // Built by the runtime per spawn when the toggle is ON: the marketplace SDK MCP server,
  // the tool ids to allow, and the workflow prose appended to the system prompt.
  mcpServers?: Record<string, unknown>;
  allowedTools?: string[];
  appendSystemPrompt?: string;
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
  return {
    msg, sid, turn, err, skill,
    emitMsg: (m: ChatMessage) => { for (const c of msg) c(m); },
    emitSid: (id: string) => { for (const c of sid) c(id); },
    emitTurn: () => { for (const c of turn) c(); },
    emitErr: (t: string) => { for (const c of err) c(t); },
    emitSkill: (n: string) => { for (const c of skill) c(n); },
  };
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

  // canUseTool: claude calls this BEFORE each tool; we translate to a neutral
  // ApprovalRequest, await the channel, and map the decision back to the SDK shape.
  const canUseTool = async (toolName: string, input: Record<string, unknown>) => {
    // A "Skill" tool call = the model is invoking an installed SKILL.md (issue #17).
    // Surface it as a transient activity signal ("Casting <skill>") — separate from the
    // approval/transcript flow, fire-and-forget. The skill name is the tool's argument.
    if (toolName === "Skill") {
      const n = (input.command ?? input.name ?? input.skill) as string | undefined;
      if (n) cb.emitSkill(String(n));
    }
    const decision = await approval.request(toApprovalRequest("claude", sessionId, toolName, input));
    if (decision.outcome === "deny") {
      return { behavior: "deny" as const, message: decision.reason ?? "Denied by user" };
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
      includePartialMessages: false,
      // use the user's installed claude (logged in) so the bundled extension doesn't
      // need the SDK's own native binary on its (unresolvable) bundle-relative path.
      pathToClaudeCodeExecutable: resolveExecutable("claude"),
      stderr: (d: string) => { if (d.trim()) cb.emitErr(`[claude] ${d.trim()}`); },
      // Passive skill-shopping wiring (issue #21). Only present when the toggle is ON;
      // when ON, the runtime hands us the marketplace MCP server + its allowed tool ids,
      // and appends the workflow prose so the agent shops for missing capabilities.
      ...(opts.appendSystemPrompt
        ? { systemPrompt: { type: "preset" as const, preset: "claude_code" as const, append: opts.appendSystemPrompt } }
        : {}),
      ...(opts.mcpServers ? { mcpServers: opts.mcpServers as never } : {}),
      ...(opts.allowedTools ? { allowedTools: opts.allowedTools } : {}),
      // NOTE: settingSources is deliberately omitted — the SDK then loads ALL sources
      // (user/project/local), which is what lets skills in the user dir (~/.claude/skills,
      // where owned NFTs + the passive workflow are installed) be discovered. Passing
      // settingSources:['project'] would DROP the user dir and break skill discovery.
    },
  });

  // drive the output generator; map each SDKMessage → ChatMessages.
  (async () => {
    try {
      for await (const m of q) {
        const r = mapClaudeMessage(m);
        if (r.sessionId && !sessionId) { sessionId = r.sessionId; cb.emitSid(r.sessionId); }
        for (const cm of r.messages) cb.emitMsg(cm);
        if (r.turnEnded) cb.emitTurn();
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
    send: (t) => push(t),
    stop: () => { closed = true; wake?.(); void q.interrupt?.().catch(() => {}); },
  };
}

// ── codex: SDK thread, one runStreamed() per turn. No interactive callback in the
// SDK (approvalPolicy only) — so we govern via policy and let the ApprovalChannel
// pre-decide once (e.g. an auto/sandbox decision). Interactive codex approval needs
// the app-server protocol, which codex-sdk doesn't expose yet. ────────────────────
function codexEngine(opts: SpawnOpts): Engine {
  const cb = callbacks();
  const approval = opts.approval ?? autoApprove();
  // same bundle-path issue as claude: point the SDK at the user's installed `codex`.
  const codex = new Codex({ codexPathOverride: resolveExecutable("codex") });
  // resume an existing thread (our injectCodex wrote it), else start fresh.
  const thread = opts.sessionId
    ? codex.resumeThread(opts.sessionId, threadOpts(opts))
    : codex.startThread(threadOpts(opts));
  let sessionId = opts.sessionId ?? "";
  let running = false;

  const runTurn = async (text: string) => {
    if (running) return; // codex is one-turn-at-a-time
    running = true;
    try {
      const { events } = await thread.runStreamed(text);
      for await (const ev of events) {
        const r = mapCodexEvent(ev);
        if (r.sessionId && !sessionId) { sessionId = r.sessionId; cb.emitSid(r.sessionId); }
        for (const cm of r.messages) cb.emitMsg(cm);
        if (r.skill) cb.emitSkill(r.skill); // a command hit our skills dir → "Casting"
        if (r.turnEnded) cb.emitTurn();
      }
    } catch (e) {
      cb.emitErr(`[codex engine] ${e instanceof Error ? e.message : String(e)}`);
      cb.emitTurn();
    } finally {
      running = false;
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
    send: (t) => {
      // codex SDK has no inline approval; surface ONE policy decision per turn so the
      // ApprovalChannel still sees the action (and can deny up front). On allow, run.
      void approval
        .request(toApprovalRequest("codex", sessionId, "turn", { text: t }))
        .then((d) => { if (d.outcome !== "deny") return runTurn(t); cb.emitTurn(); });
    },
    stop: () => { /* codex turns are short-lived; nothing long-running to kill */ },
  };
}

function threadOpts(opts: SpawnOpts) {
  return {
    workingDirectory: opts.cwd,
    skipGitRepoCheck: true,
    model: opts.model,
    sandboxMode: "workspace-write" as const,
    approvalPolicy: "on-failure" as const,
  };
}

// Build a neutral ApprovalRequest from a raw tool name + input (claude tools, or a
// codex turn). `kind`/fields let a surface render a good card without re-parsing.
function toApprovalRequest(
  cli: "claude" | "codex",
  sessionId: string,
  tool: string,
  input: Record<string, unknown>,
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
    return { id, cli, sessionId, tool, kind: "bash", title: "Run: " + firstLine(command), command, input };
  }
  if (tool === "Edit" || tool === "MultiEdit") {
    return { id, cli, sessionId, tool, kind: "edit", title: "Edit " + baseName(file), file, input };
  }
  if (tool === "Write") return { id, cli, sessionId, tool, kind: "write", title: "Write " + baseName(file), file, input };
  if (tool === "Read") return { id, cli, sessionId, tool, kind: "read", title: "Read " + baseName(file), file, input };
  return { id, cli, sessionId, tool, kind: "other", title: tool, input };
}

function randomId(): string { return "ap_" + Math.random().toString(36).slice(2, 11); }
function strOr(v: unknown): string { return typeof v === "string" ? v : ""; }
function firstLine(s: string): string { return (s.split("\n")[0] || "").slice(0, 80); }
function baseName(p: string): string { return p ? p.split("/").pop() || p : ""; }
