// Shared shape returned by every CLI event mapper (claude.ts, codex.ts).
// Keeping it here lets runtime treat all CLIs uniformly.

import type { ChatMessage, RateLimitInfo } from "../contract.js";

export interface ParseResult {
  sessionId?: string; // set when the engine reveals its session/thread id
  messages: ChatMessage[]; // 0+ complete messages emitted by this event
  turnEnded: boolean; // true when the engine signals the turn is done
  // raw installed-skill candidate from this event. Runtime filters this to nft origin.
  skill?: string;
  // Tokens in the last main-model request (including cached input).
  // Turn-level aggregate billing and subagent requests must not populate this field.
  contextTokens?: number;
  // plan rate-limit utilization from a rate_limit_event (claude.ai accounts). Lets a
  // surface draw a "used N% of your limit" gauge. Absent on ordinary frames.
  rateLimit?: RateLimitInfo;
}
