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
  const allowed = new Set<string>();
  const READONLY = new Set(["Read", "Glob", "Grep", "LS", "NotebookRead", "TodoWrite", "WebFetch", "WebSearch"]);
  const actionKey = (req: ApprovalRequest) =>
    req.kind === "bash" ? `bash:${req.command}` : `${req.tool}:${req.file || ""}`;

  // canUseTool: claude calls this BEFORE each tool; we translate to a neutral
  // ApprovalRequest, await the channel, and map the decision back to the SDK shape.
  const canUseTool = async (toolName: string, input: Record<string, unknown>) => {
    if (READONLY.has(toolName)) return { behavior: "allow" as const, updatedInput: input };
    const req = toApprovalRequest("claude", sessionId, toolName, input, opts.cwd);
    const key = actionKey(req);
    if (allowed.has(key)) return { behavior: "allow" as const, updatedInput: input };
    const decision = await approval.request(req);
    if (decision.outcome === "deny") {
      return { behavior: "deny" as const, message: decision.reason ?? "Denied by user" };
    }
    if (decision.outcome === "always") allowed.add(key); // remember for the rest of the session
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
        // codex partials are already full snapshots (item.updated) → emit as-is.
        for (const cm of r.messages) cb.emitMsg(cm);
        if (r.contextTokens !== undefined) cb.emitUsage(r.contextTokens);
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
    onUsage: (c) => cb.use.push(c),
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
