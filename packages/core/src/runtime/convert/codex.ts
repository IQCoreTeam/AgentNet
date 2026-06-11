// Map codex Agent SDK (@openai/codex-sdk) ThreadEvents into neutral ChatMessages.
//   {type:"thread.started", thread_id}                                     → sessionId
//   {type:"item.completed", item:{type:"agent_message", text}}             → assistant
//   {type:"item.completed", item:{type:"reasoning", text}}                 → thinking
//   {type:"item.completed", item:{type:"command_execution", command, …}}   → tool (bash)
//   {type:"item.completed", item:{type:"file_change", changes[]}}          → tool (file op)
//   {type:"turn.completed" | "turn.failed"}                                → turn end

import type { ParseResult } from "./types.js";

const OUTPUT_CAP = 4000;

// We accept `unknown` and narrow so the runtime needn't import SDK types.
// One ThreadEvent → 0+ ChatMessages.
export function mapCodexEvent(ev: unknown): ParseResult {
  const out: ParseResult = { messages: [], turnEnded: false };
  if (!ev || typeof ev !== "object") return out;
  const e = ev as {
    type?: string;
    thread_id?: string;
    message?: string; // stream-level error event
    error?: { message?: string }; // turn.failed
    usage?: { input_tokens?: number; cached_input_tokens?: number };
    item?: {
      type?: string;
      text?: string;
      command?: string;
      aggregated_output?: string;
      exit_code?: number;
      changes?: { path: string; kind: string }[];
      items?: { text: string; completed: boolean }[];
    };
  };

  if (e.type === "thread.started" && e.thread_id) out.sessionId = e.thread_id;

  // STREAMING: codex has no token-delta event, but item.updated re-emits the agent_message
  // with its full text-so-far (a snapshot, not a delta). Surface it as a partial — the
  // surface replaces the live line each time (same replace-semantics claude's accumulated
  // partials use). Only agent_message; other items settle via item.completed below.
  if (e.type === "item.updated" && e.item?.type === "agent_message" && e.item.text) {
    out.messages.push({ role: "assistant", text: e.item.text, ts: Date.now(), partial: true });
    return out;
  }

  // we surface each item ONCE, on completion (item.completed), to avoid duplicating
  // the in-progress/updated frames of the same item.
  if (e.type === "item.completed" && e.item) {
    const it = e.item;
    if (it.type === "agent_message" && it.text) {
      out.messages.push({ role: "assistant", text: it.text, ts: Date.now() });
    } else if (it.type === "reasoning" && it.text) {
      out.messages.push({ role: "thinking", text: it.text, ts: Date.now() });
    } else if (it.type === "command_execution" && it.command) {
      out.messages.push({
        role: "tool",
        text: it.command.split("\n")[0]?.slice(0, 80) || "bash",
        ts: Date.now(),
        tool: { name: "Bash", command: it.command, output: (it.aggregated_output ?? "").slice(0, OUTPUT_CAP), exitCode: it.exit_code },
      });
    } else if (it.type === "todo_list" && Array.isArray(it.items)) {
      // normalize codex todos {text,completed} → the neutral TodoWrite shape so the same
      // checklist panel renders for both engines.
      const todos = it.items.map((t) => ({ content: t.text, status: t.completed ? "completed" : "pending" }));
      out.messages.push({ role: "tool", text: "TodoWrite", ts: Date.now(), tool: { name: "TodoWrite", output: JSON.stringify(todos) } });
    } else if (it.type === "file_change" && Array.isArray(it.changes)) {
      // codex reports WHICH files changed (add/update/delete) but not a line diff;
      // surface each as a file-op tool card.
      for (const c of it.changes) {
        out.messages.push({
          role: "tool",
          text: c.kind + " " + (c.path.split("/").pop() || c.path),
          ts: Date.now(),
          tool: { name: c.kind === "delete" ? "Delete" : "Write", file: c.path },
        });
      }
    }
  }

  // surface a readable failure (usage limit, etc.) instead of letting the engine wrapper
  // report a cryptic non-zero exit. Both the stream `error` event and `turn.failed` carry
  // a message — show it as a tool/error card.
  const failMsg = e.type === "error" ? e.message : e.type === "turn.failed" ? e.error?.message : undefined;
  if (failMsg) {
    out.messages.push({ role: "tool", text: failMsg, ts: Date.now(), tool: { name: "Error", output: failMsg, exitCode: 1 } });
  }

  if (e.type === "turn.completed" || e.type === "turn.failed") out.turnEnded = true;
  // codex reports per-turn usage on completion; context occupancy = input + cached input.
  if (e.type === "turn.completed" && e.usage) {
    out.contextTokens = (e.usage.input_tokens ?? 0) + (e.usage.cached_input_tokens ?? 0);
  }
  return out;
}
