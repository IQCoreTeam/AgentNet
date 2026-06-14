// Map codex Agent SDK (@openai/codex-sdk) ThreadEvents into neutral ChatMessages.
//   {type:"thread.started", thread_id}                                     → sessionId
//   {type:"item.completed", item:{type:"agent_message", text}}             → assistant
//   {type:"item.completed", item:{type:"reasoning", text}}                 → thinking
//   {type:"item.completed", item:{type:"command_execution", command, …}}   → tool (bash)
//   {type:"item.completed", item:{type:"file_change", changes[]}}          → tool (file op)
//   {type:"turn.completed" | "turn.failed"}                                → turn end

import type { ParseResult } from "./types.js";
import { codexSkillsDir } from "../../core/paths.js";

const OUTPUT_CAP = 4000;

// codex has no per-tool hook (unlike claude's canUseTool), so we detect a skill firing
// from the event itself: any command/path that references our skills dir means an
// installed skill is being used. We own that dir, so matching its path is reliable —
// extract the <slug> right after it. Returns the skill slug, or undefined.
function skillFromPath(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const root = codexSkillsDir();
  const i = text.indexOf(root + "/");
  if (i < 0) return undefined;
  const rest = text.slice(i + root.length + 1);
  const slug = rest.split(/[/\s'"]/)[0];
  return slug || undefined;
}

// We accept `unknown` and narrow so the runtime needn't import SDK types.
// One ThreadEvent → 0+ ChatMessages.
export function mapCodexEvent(ev: unknown): ParseResult {
  const out: ParseResult = { messages: [], turnEnded: false };
  if (!ev || typeof ev !== "object") return out;
  const e = ev as {
    type?: string;
    thread_id?: string;
    item?: {
      type?: string;
      text?: string;
      command?: string;
      aggregated_output?: string;
      exit_code?: number;
      changes?: { path: string; kind: string }[];
    };
  };

  if (e.type === "thread.started" && e.thread_id) out.sessionId = e.thread_id;

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
      // a command touching our skills dir = an installed skill firing → "Casting" cue
      out.skill = skillFromPath(it.command) ?? out.skill;
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

  if (e.type === "turn.completed" || e.type === "turn.failed") out.turnEnded = true;
  return out;
}
