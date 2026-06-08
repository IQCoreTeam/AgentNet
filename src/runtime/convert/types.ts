// Shared shape returned by every CLI line parser (claude.ts, codex.ts).
// Keeping it here lets runtime treat all CLIs uniformly.

import type { ChatMessage } from "../contract.js";

export interface ParseResult {
  sessionId?: string; // set when the CLI reveals its session/thread id
  messages: ChatMessage[]; // 0+ complete messages emitted by this line
  turnEnded: boolean; // true when the CLI signals the turn is done
}

// A line parser for one CLI's stream-json/jsonl output.
export type LineParser = (line: string) => ParseResult;
