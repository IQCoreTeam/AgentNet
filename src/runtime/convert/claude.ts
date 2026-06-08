// Parse claude CLI stream-json lines into our neutral ChatMessage.
// Reference: opencode-claude-code-plugin claude-code-language-model.ts (line loop).
// We only need: session_id (from system/init), assistant text/thinking, turn end (result).
// Tool details are folded into a "tool" message for now (kept minimal).

import type { ParseResult } from "./types.js";

// claude stream-json shapes we read (loose — ignore the rest)
interface ClaudeLine {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: { content?: Array<{ type: string; text?: string; thinking?: string }> };
}

export function parseClaudeLine(line: string): ParseResult {
  const out: ParseResult = { messages: [], turnEnded: false };
  const trimmed = line.trim();
  if (!trimmed) return out;

  let msg: ClaudeLine;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return out; // non-JSON line — ignore
  }

  if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
    out.sessionId = msg.session_id;
  }

  // Complete assistant message (whole-turn mode; deltas added later via `partial`)
  if (msg.type === "assistant" && msg.message?.content) {
    for (const block of msg.message.content) {
      if (block.type === "text" && block.text) {
        out.messages.push({ role: "assistant", text: block.text, ts: Date.now() });
      } else if (block.type === "thinking" && block.thinking) {
        out.messages.push({ role: "thinking", text: block.thinking, ts: Date.now() });
      }
    }
  }

  if (msg.type === "result") {
    if (msg.session_id) out.sessionId = msg.session_id;
    out.turnEnded = true;
  }

  return out;
}
