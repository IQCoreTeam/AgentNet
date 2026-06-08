// Parse codex `exec --json` JSONL lines into our neutral ChatMessage.
// Real events (verified by running codex exec --json):
//   {"type":"thread.started","thread_id":"<uuid>"}          → sessionId
//   {"type":"item.completed","item":{"type":"agent_message","text":"..."}} → assistant
//   {"type":"item.completed","item":{"type":"reasoning","text":"..."}}      → thinking
//   {"type":"turn.completed","usage":{...}}                 → turn end
// Same ParseResult shape as claude.ts so runtime treats both uniformly.

import type { ParseResult } from "./types.js";

interface CodexLine {
  type: string;
  thread_id?: string;
  item?: { type?: string; text?: string };
}

export function parseCodexLine(line: string): ParseResult {
  const out: ParseResult = { messages: [], turnEnded: false };
  const trimmed = line.trim();
  if (!trimmed) return out;

  let msg: CodexLine;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return out; // non-JSON line — ignore
  }

  if (msg.type === "thread.started" && msg.thread_id) {
    out.sessionId = msg.thread_id;
  }

  if (msg.type === "item.completed" && msg.item?.text) {
    if (msg.item.type === "agent_message") {
      out.messages.push({ role: "assistant", text: msg.item.text, ts: Date.now() });
    } else if (msg.item.type === "reasoning") {
      out.messages.push({ role: "thinking", text: msg.item.text, ts: Date.now() });
    }
  }

  if (msg.type === "turn.completed") {
    out.turnEnded = true;
  }

  return out;
}
