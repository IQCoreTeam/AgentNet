// Shared shape returned by every CLI event mapper (claude.ts, codex.ts).
// Keeping it here lets runtime treat all CLIs uniformly.

import type { ChatMessage } from "../contract.js";

export interface ParseResult {
  sessionId?: string; // set when the engine reveals its session/thread id
  messages: ChatMessage[]; // 0+ complete messages emitted by this event
  turnEnded: boolean; // true when the engine signals the turn is done
  // tokens occupying the context window after this event (input + cached + cache-create).
  // Set on a turn-final/result frame; lets a surface show a real context-left meter.
  contextTokens?: number;
}
