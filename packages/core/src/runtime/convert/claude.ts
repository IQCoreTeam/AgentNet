// Map claude Agent SDK messages into neutral ChatMessages.
// Captures: session_id (system/init), assistant text/thinking, TOOL actions
// (bash / edits / reads…), tool RESULTS (command output), compact boundary, turn end.
// The assistant payload is a real Anthropic message (content[] of text/thinking/
// tool_use blocks), so the block mapping (toolUseMessage/makeDiff) is shared.

import type { ChatMessage } from "../contract.js";
import type { ParseResult } from "./types.js";
import { displayFileName } from "./toolFormatting.js";

interface Block {
  type: string;
  text?: string;
  thinking?: string;
  // tool_use
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  // tool_result
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

const OUTPUT_CAP = 4000;
const base = (text: string): ChatMessage => ({ role: "tool", text, ts: Date.now() });

// old/new → a line-level INTERLEAVED diff via LCS, so unchanged lines render as context
// (" ") between the "-"/"+" changes instead of one block of removals then one of additions.
// Edit old/new strings are usually a small region, so the O(m·n) table is cheap; we guard
// against a pathological size and fall back to the plain block form.
function makeDiff(oldStr = "", newStr = ""): string {
  const a = oldStr.split("\n");
  const b = newStr.split("\n");
  if (a.length * b.length > 250_000) {
    return [...a.map((l) => "-" + l), ...b.map((l) => "+" + l)].slice(0, 200).join("\n");
  }
  const m = a.length;
  const n = b.length;
  // dp[i][j] = LCS length of a[i:], b[j:]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) out.push(" " + a[i++]), j++;
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push("-" + a[i++]);
    else out.push("+" + b[j++]);
  }
  while (i < m) out.push("-" + a[i++]);
  while (j < n) out.push("+" + b[j++]);
  return out.slice(0, 200).join("\n");
}

// tool_result.content can be a string or an array of {type:"text",text} parts.
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : ""))
      .join("");
  }
  return "";
}

function toolUseMessage(b: Block): ChatMessage {
  const input = b.input || {};
  const name = b.name!;
  switch (name) {
    case "Bash": {
      const command = String(input.command ?? "");
      return { ...base(command.split("\n")[0]?.slice(0, 80) || "bash"), tool: { name, command } };
    }
    case "Edit":
    case "MultiEdit": {
      const file = String(input.file_path ?? "");
      return {
        ...base("Edit " + displayFileName(file)),
        tool: { name: "Edit", file, diff: makeDiff(String(input.old_string ?? ""), String(input.new_string ?? "")) },
      };
    }
    case "Write": {
      const file = String(input.file_path ?? "");
      return { ...base("Write " + displayFileName(file)), tool: { name, file } };
    }
    case "Read": {
      const file = String(input.file_path ?? "");
      return { ...base("Read " + displayFileName(file)), tool: { name, file } };
    }
    case "TodoWrite": {
      // preserve the structured todo list in `output` (JSON) so a surface can render it
      // as a checklist; the neutral ToolAction shape needs no new field.
      const todos = Array.isArray(input.todos) ? input.todos : [];
      return { ...base("TodoWrite"), tool: { name, output: JSON.stringify(todos) } };
    }
    case "Agent": {
      const title = String(input.description ?? "subagent");
      return { ...base("Agent: " + title), tool: { name, command: title } };
    }
    default: {
      // generic: a short title from the most descriptive input field
      const title = String(input.description ?? input.query ?? input.pattern ?? input.url ?? name);
      return { ...base(name + (title && title !== name ? ": " + title : "")), tool: { name, command: title } };
    }
  }
}

// We accept `unknown` and narrow internally so the runtime needn't import SDK types.
export function mapClaudeMessage(m: unknown): ParseResult {
  const out: ParseResult = { messages: [], turnEnded: false };
  if (!m || typeof m !== "object") return out;
  const msg = m as {
    type?: string;
    subtype?: string;
    session_id?: string;
    compact_metadata?: unknown;
    message?: { content?: Block[] | string; role?: string };
    event?: { type?: string; delta?: { type?: string; text?: string } };
    usage?: {
      input_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };

  // system/init and any assistant/result frame carries the session id.
  if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
    out.sessionId = msg.session_id;
  }
  if (msg.session_id && !out.sessionId) out.sessionId = msg.session_id;

  // streaming: a partial text delta (only sent when includePartialMessages is on). Emit
  // it as a partial:true assistant chunk; the surface coalesces deltas into the live line.
  // The final complete `assistant` frame (below) still arrives as the partial:false text.
  if (msg.type === "stream_event") {
    const ev = msg.event;
    if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
      out.messages.push({ role: "assistant", text: ev.delta.text, ts: Date.now(), partial: true });
    }
    return out;
  }

  // a compact boundary = claude condensed the history; surface a summary record so
  // it folds in cross-CLI exactly like the line path's isCompactSummary.
  if (msg.type === "compact_boundary") {
    out.messages.push({ role: "summary", text: "[conversation compacted]", ts: Date.now() });
    return out;
  }

  if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
    for (const b of msg.message!.content as Block[]) {
      if (b.type === "text" && b.text) out.messages.push({ role: "assistant", text: b.text, ts: Date.now() });
      else if (b.type === "thinking" && b.thinking) out.messages.push({ role: "thinking", text: b.thinking, ts: Date.now() });
      else if (b.type === "tool_use" && b.name) out.messages.push(toolUseMessage(b));
    }
  }

  // a user frame may carry tool_result blocks (a prior tool's output). The SDK doesn't
  // give us the id→name map the line path used, so we surface any NON-EMPTY result as
  // a tool output card (the preceding tool_use card already labels what ran).
  if (msg.type === "user" && Array.isArray(msg.message?.content)) {
    for (const b of msg.message!.content as Block[]) {
      if (b.type !== "tool_result") continue;
      const output = resultText(b.content).slice(0, OUTPUT_CAP);
      if (!output.trim()) continue;
      out.messages.push({
        ...base(output.split("\n")[0]?.slice(0, 80) || "output"),
        tool: { name: "Bash", output, exitCode: b.is_error ? 1 : 0 },
      });
    }
  }

  // a 'result' frame ends the turn — and carries the turn's token usage. The context
  // window occupancy = input + cache-read + cache-create (the full prompt that was sent).
  if (msg.type === "result") {
    out.turnEnded = true;
    const u = msg.usage;
    if (u) {
      out.contextTokens =
        (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    }
  }
  return out;
}
