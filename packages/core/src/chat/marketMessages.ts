// The marketplace + skill message contract — the single source of truth for the
// JSON every surface (VSCode webview, mobile/browser React, CLI) exchanges with the
// chat host over its transport. UI and host live in different worlds (postMessage /
// HTTP-RPC+SSE), so they can't share a function call — they share THIS shape instead.
//
// Each surface designs its OWN screens, but imports these types so the messages they
// send/receive are checked at compile time: a typo'd `type`, a missing field, or a
// renamed payload becomes a red squiggle instead of a silent runtime no-op. When a new
// surface (or a split-out repo) wires the same market, it imports this and can't drift.
//
// Direction is in the name: *Request = UI -> host; *Event = host -> UI.

/** One skill row as the UI renders it (search results / cards). Mirrors the subset of
 *  `Skill` a card needs — kept here so host (searchSkills env callback) and UI agree. */
export interface SkillCard {
  id: string; // mint address
  name: string;
  description?: string;
  supply?: number; // popularity
  creator?: string; // wallet (paid on a priced buy)
}

// ── UI -> host (requests) ───────────────────────────────────────────────────
export type MarketRequest =
  | { type: "searchSkills"; query: string }
  | { type: "buySkill"; skillId: string; creatorWallet?: string }
  | { type: "ownedSkills" }; // ask the host to (re)send the owned list

// ── host -> UI (responses / pushes) ─────────────────────────────────────────
export type MarketEvent =
  | { type: "searchResults"; results: SkillCard[] }
  | { type: "buyResult"; skillId: string; ok: boolean; slug?: string; error?: string }
  | { type: "ownedSkills"; names: string[] } // installed skill names (panel fill)
  | { type: "skillActive"; name: string }; // a skill fired -> "Casting <name>" cue

export type MarketMessage = MarketRequest | MarketEvent;
