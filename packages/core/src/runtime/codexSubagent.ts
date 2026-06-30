// Claudex "Team mode" — Claude (lead brain) spawns Codex worker subagents.
// See plans/claudex-team-mode.md.
//
// One MCP tool (spawn_codex_subagents) is exposed to a Claude session. Its handler
// runs each task as its OWN headless Codex engine (reusing spawnCli — no new
// orchestrator), buffers the worker's output, and returns it to Claude as tool text.
// Promise.all over the tasks = real parallel workers from a single tool call.
//
// Depth guard is automatic: workers are spawned via spawnCli directly (NOT via the
// runtime's startSession), so they never receive this tool back. No recursion.
//
// Two worker capabilities, chosen by the lead session's mode:
//   - researcher (default): a read-only approval gate — workers may read/search the
//     repo and reason, but every write/patch is denied. The lead Claude applies any
//     changes itself (through its OWN normal approval gate), so only Claude's merged
//     edits ever touch the user's files.
//   - coder (Claudex mode ON): workers may write in the session cwd (autoApprove).
//     Turning on the Claudex chip IS the user's consent to a team that edits files.
// ponytail: coder workers write straight to the real cwd; the lead assigns
// non-overlapping files to avoid clobber. True per-worker scratch worktrees only if
// parallel write conflicts actually bite.

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { resolve, sep } from "node:path";
import { spawnCli } from "./spawn.js";
import type { ApprovalChannel, ApprovalRequest, ApprovalDecision } from "./approval/channel.js";
import type { ChatMessage } from "./contract.js";

export const CLAUDEX_MCP_SERVER = "claudex";
export const CLAUDEX_SPAWN_TOOL = "spawn_codex_subagents";

// A worker can run long; don't let one hung worker block Claude forever.
const WORKER_TIMEOUT_MS = 5 * 60_000; // ponytail: 5 min cap, raise if real jobs need it
const MAX_OUTPUT_CHARS = 8_000; // cap per-worker text fed back to the lead

// Commands a researcher worker may run (read-only). Prefix match on the first token.
const READ_CMDS = new Set([
  "ls", "cat", "head", "tail", "grep", "rg", "find", "fd", "pwd", "echo",
  "wc", "tree", "stat", "file", "which", "git", // git gated further below
]);
const GIT_WRITE = /\b(commit|push|reset|checkout|merge|rebase|clean|add|rm|restore|stash|apply|tag)\b/;

function isReadOnlyCommand(cmd: string): boolean {
  const first = cmd.trim().split(/\s+/)[0] ?? "";
  if (!READ_CMDS.has(first)) return false;
  if (first === "git") return !GIT_WRITE.test(cmd); // allow git status/log/diff/show only
  return true;
}

// Destructive / exfiltration patterns denied even for a coder worker. A worker that reads
// a poisoned file (prompt injection) must not be able to wipe the disk, push, or pipe a
// download into a shell just because the chip auto-approves. Codex's own sandbox blocks
// some of this; this is belt-and-suspenders at the approval gate.
// ponytail: pattern list, not a real shell parser — covers the obvious blast radius.
export function isDangerousCommand(cmd: string): boolean {
  return /\brm\s+-[a-z]*[rf]|sudo\b|\bmkfs\b|\bdd\s+if=|:\(\)\s*\{|\bchmod\s+-R|\bchown\s+-R|\bgit\s+push\b|\b(curl|wget)\b[^\n]*\|\s*(sh|bash|zsh)|>\s*\/dev\/(sd|disk|null\/)|\bshutdown\b|\breboot\b/i.test(cmd);
}

// Is `file` inside `cwd`? Workers must not read/write OUTSIDE their working dir — that's
// how a rogue worker would touch ~/.ssh or another project.
export function isPathInside(file: string, cwd: string): boolean {
  const r = resolve(cwd, file);
  const base = resolve(cwd);
  return r === base || r.startsWith(base + sep);
}

// Researcher gate: allow reads (inside cwd), deny writes/patches/prompts.
function readOnlyGate(cwd: string): ApprovalChannel {
  return {
    request: async (req: ApprovalRequest): Promise<ApprovalDecision> => {
      if (req.kind === "read" && (!req.file || isPathInside(req.file, cwd))) return { outcome: "once" };
      if (req.kind === "bash" && req.command && isReadOnlyCommand(req.command) && !isDangerousCommand(req.command)) return { outcome: "once" };
      return { outcome: "deny", reason: "Researcher subagent is read-only — report findings instead of writing." };
    },
  };
}

// Coder gate: workers may write IN cwd (consent = the Claudex chip), but never run a
// destructive/exfil command or touch a path outside the working dir.
function coderGate(cwd: string): ApprovalChannel {
  return {
    request: async (req: ApprovalRequest): Promise<ApprovalDecision> => {
      if (req.kind === "bash" && req.command && isDangerousCommand(req.command)) {
        return { outcome: "deny", reason: "Blocked: destructive or network-pipe command not allowed in Team mode." };
      }
      if ((req.kind === "edit" || req.kind === "write" || req.kind === "read") && req.file && !isPathInside(req.file, cwd)) {
        return { outcome: "deny", reason: "Blocked: workers may only touch files inside the project folder." };
      }
      return { outcome: "once" };
    },
  };
}

export interface CodexTask {
  goal: string;
  cwd?: string;
  model?: string;
}
export interface CodexResult {
  goal: string;
  output: string;
  filesChanged: string[];
}

// Runtime-supplied hooks so the in-process tool can talk back to the live session:
//   notify  → a transient status cue (drives the "Casting …" marquee) for the war-room
//   approval/sessionId → the ONE plain-language gate shown before the team touches files
export interface ClaudexHooks {
  notify?: (text: string) => void;
  approval?: ApprovalChannel;
  sessionId?: () => string;
}

// Run ONE Codex worker to completion. Resolves on the worker's turn end (or error /
// timeout) with its assistant text and any files it touched. Never rejects — a failed
// worker returns its error as output so Claude can react instead of the tool throwing.
export function runCodexTask(task: CodexTask, defaultCwd: string, write: boolean, label?: string, hooks?: ClaudexHooks): Promise<CodexResult> {
  return new Promise((resolve) => {
    const cwd = task.cwd || defaultCwd;
    hooks?.notify?.(`${label || "Codex worker"} working`);
    const cli = spawnCli({
      cli: "codex",
      cwd,
      model: task.model,
      approval: write ? coderGate(cwd) : readOnlyGate(cwd),
      stream: false,
    });

    const chunks: string[] = [];
    const filesChanged = new Set<string>();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { cli.stop(); } catch { /* already gone */ }
      hooks?.notify?.(`${label || "Codex worker"} done`);
      let output = chunks.join("\n").trim();
      if (output.length > MAX_OUTPUT_CHARS) output = output.slice(0, MAX_OUTPUT_CHARS) + "\n…[truncated]";
      resolve({ goal: task.goal, output, filesChanged: [...filesChanged] });
    };
    const timer = setTimeout(() => {
      chunks.push("[worker timed out]");
      finish();
    }, WORKER_TIMEOUT_MS);

    cli.onMessage((m: ChatMessage) => {
      if (m.partial) return;
      if (m.role === "assistant") chunks.push(m.text);
      if (m.role === "tool" && m.tool?.file) filesChanged.add(m.tool.file);
    });
    cli.onError((t: string) => { chunks.push(`[error] ${t}`); finish(); });
    cli.onTurnEnd(() => finish());

    cli.send(task.goal);
  });
}

// Fan out: N workers in parallel, one Promise per task. Single-worker is just length 1.
// ponytail: cap 4 workers — Claude can ask for more, we clamp. Raise when a job needs it.
export function runCodexTasks(tasks: CodexTask[], defaultCwd: string, write: boolean, hooks?: ClaudexHooks): Promise<CodexResult[]> {
  return Promise.all(tasks.slice(0, 4).map((t, i) => runCodexTask(t, defaultCwd, write, `Codex #${i + 1}`, hooks)));
}

// The SDK MCP server that exposes the fan-out tool to a Claude session. `write` = the
// session is in Claudex mode (workers may edit files); otherwise workers are researchers.
export function createClaudexMcpServer(defaultCwd: string, write: boolean, hooks?: ClaudexHooks) {
  const capability = write
    ? "Each worker can READ and EDIT files in the working directory."
    : "Each worker is READ-ONLY: it researches and reports, but cannot edit files — YOU apply any changes yourself afterward.";
  const spawnTool = tool(
    CLAUDEX_SPAWN_TOOL,
    "Spawn 1–4 Codex worker subagents that run IN PARALLEL, then return each worker's " +
      "result. This is your DEFAULT way to work in Team mode: whenever the user's request " +
      "has 2+ independent parts (separate files, separate components, research + build, " +
      "multiple checks), break it into one task per part and call this ONCE with all of " +
      "them — do not do the parts yourself one by one. The user does not need to name the " +
      "workers; YOU decide the split. Only skip fan-out for a truly single-step task. " +
      "Give each worker a complete, self-contained goal and assign non-overlapping files. " +
      "After they return, wire the pieces together and report. " +
      capability,
    {
      tasks: z
        .array(
          z.object({
            goal: z.string().describe("Plain-language task for this one worker to do."),
            cwd: z.string().optional().describe("Working directory for this worker. Defaults to the session cwd."),
            model: z.string().optional().describe("Optional Codex model override (e.g. 'gpt-5.5-codex')."),
          }),
        )
        .min(1)
        .max(4)
        .describe("1–4 independent tasks to run in parallel, one Codex worker each. Prefer 2+ when the job splits cleanly."),
    },
    async (args: { tasks: CodexTask[] }) => {
      // ONE plain-language gate before the team touches files (Claudex mode only — in
      // researcher mode workers can't write, so no approval needed). Goals go in `plan`
      // so the user sees exactly what the team will do, and decides once.
      if (write && hooks?.approval) {
        const goals = args.tasks.map((t, i) => `${i + 1}. ${t.goal}`).join("\n");
        const decision = await hooks.approval.request({
          id: "claudex-" + Date.now(),
          cli: "claude",
          sessionId: hooks.sessionId?.() || "",
          tool: "Team",
          kind: "other",
          title: `Run ${args.tasks.length} Codex worker${args.tasks.length === 1 ? "" : "s"} that may edit files in this folder`,
          plan: goals,
        });
        if (decision.outcome === "deny") {
          return { content: [{ type: "text" as const, text: "The user declined to run the Codex team." + (decision.reason ? " Reason: " + decision.reason : "") }] };
        }
      }
      const results = await runCodexTasks(args.tasks, defaultCwd, write, hooks);
      return { content: [{ type: "text" as const, text: JSON.stringify({ results }, null, 2) }] };
    },
  );

  return createSdkMcpServer({ name: CLAUDEX_MCP_SERVER, version: "0.0.1", tools: [spawnTool] as any[] });
}

export const claudexAllowedTools = (): string[] => [`mcp__${CLAUDEX_MCP_SERVER}__${CLAUDEX_SPAWN_TOOL}`];
