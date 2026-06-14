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

/** RPC status the UI shows (issue #23). `dasReady` = a DAS-capable RPC (a Helius key
 *  or explicit env) is configured; on the bare public default it's false, so reads
 *  come back empty and the UI nudges the user to add a Helius key. The default itself
 *  is never surfaced — the user only ever sees "has key" vs "set a key". `masked` is
 *  the key's last few chars (rest dotted), null when none. `network` drives the badge. */
export interface RpcStatus {
  dasReady: boolean;
  hasKey: boolean; // a Helius key is set
  masked: string | null; // "••••AB12" for the green box, null when no key
  network: "devnet" | "mainnet"; // the central network badge
}

// ── UI -> host (requests) ───────────────────────────────────────────────────
export type MarketRequest =
  | { type: "searchSkills"; query: string }
  | { type: "buySkill"; skillId: string; creatorWallet?: string }
  | { type: "ownedSkills" } // ask the host to (re)send the owned list
  | { type: "setHeliusKey" } // host opens a native input to capture + save the key
  | { type: "useDefaultRpc" } // clear any key, fall back to the default
  | { type: "getRpcStatus" }; // ask the host to (re)send rpcStatus

// ── host -> UI (responses / pushes) ─────────────────────────────────────────
export type MarketEvent =
  | { type: "searchResults"; results: SkillCard[] }
  | { type: "buyResult"; skillId: string; ok: boolean; slug?: string; error?: string }
  | { type: "ownedSkills"; names: string[] } // installed skill names (panel fill)
  | { type: "skillActive"; name: string } // a skill fired -> "Casting <name>" cue
  | { type: "rpcStatus"; status: RpcStatus }; // DAS-ready? which source? (issue #23)

export type MarketMessage = MarketRequest | MarketEvent;
