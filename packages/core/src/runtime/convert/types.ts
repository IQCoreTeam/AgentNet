// Shared shape returned by every CLI event mapper (claude.ts, codex.ts).
// Keeping it here lets runtime treat all CLIs uniformly.

import type { ChatMessage } from "../contract.js";

export interface ParseResult {
  sessionId?: string; // set when the engine reveals its session/thread id
  messages: ChatMessage[]; // 0+ complete messages emitted by this event
  turnEnded: boolean; // true when the engine signals the turn is done
  // an installed skill fired this event → the "Casting <skill>" cue (issue #17). For
  // codex (no per-tool hook) we detect it from the event referencing our skills dir.
  skill?: string;
}
