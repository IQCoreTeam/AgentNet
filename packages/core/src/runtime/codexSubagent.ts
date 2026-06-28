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

// Researcher gate: allow reads, deny writes/patches/prompts. Workers can't mutate the repo.
function readOnlyGate(): ApprovalChannel {
  return {
    request: async (req: ApprovalRequest): Promise<ApprovalDecision> => {
      if (req.kind === "read") return { outcome: "once" };
      if (req.kind === "bash" && req.command && isReadOnlyCommand(req.command)) return { outcome: "once" };
      return { outcome: "deny", reason: "Researcher subagent is read-only — report findings instead of writing." };
    },
  };
}

// Coder gate: workers may act freely in the session cwd (consent = the Claudex chip).
function coderGate(): ApprovalChannel {
  return { request: async () => ({ outcome: "once" }) };
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

// Run ONE Codex worker to completion. Resolves on the worker's turn end (or error /
// timeout) with its assistant text and any files it touched. Never rejects — a failed
// worker returns its error as output so Claude can react instead of the tool throwing.
export function runCodexTask(task: CodexTask, defaultCwd: string, write: boolean): Promise<CodexResult> {
  return new Promise((resolve) => {
    const cwd = task.cwd || defaultCwd;
    const cli = spawnCli({
      cli: "codex",
      cwd,
      model: task.model,
      approval: write ? coderGate() : readOnlyGate(),
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
export function runCodexTasks(tasks: CodexTask[], defaultCwd: string, write: boolean): Promise<CodexResult[]> {
  return Promise.all(tasks.slice(0, 4).map((t) => runCodexTask(t, defaultCwd, write)));
}

// The SDK MCP server that exposes the fan-out tool to a Claude session. `write` = the
// session is in Claudex mode (workers may edit files); otherwise workers are researchers.
export function createClaudexMcpServer(defaultCwd: string, write: boolean) {
  const capability = write
    ? "Each worker can READ and EDIT files in the working directory."
    : "Each worker is READ-ONLY: it researches and reports, but cannot edit files — YOU apply any changes yourself afterward.";
  const spawnTool = tool(
    CLAUDEX_SPAWN_TOOL,
    "Spawn 1–4 Codex worker subagents to work on tasks IN PARALLEL, then return each " +
      "worker's result. Split a big job into independent tasks and call once with all of " +
      "them; the workers run at the same time. Assign non-overlapping files per worker. " +
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
        .describe("1–4 independent tasks to run in parallel, one Codex worker each."),
    },
    async (args: { tasks: CodexTask[] }) => {
      const results = await runCodexTasks(args.tasks, defaultCwd, write);
      return { content: [{ type: "text" as const, text: JSON.stringify({ results }, null, 2) }] };
    },
  );

  return createSdkMcpServer({ name: CLAUDEX_MCP_SERVER, version: "0.0.1", tools: [spawnTool] as any[] });
}

export const claudexAllowedTools = (): string[] => [`mcp__${CLAUDEX_MCP_SERVER}__${CLAUDEX_SPAWN_TOOL}`];
