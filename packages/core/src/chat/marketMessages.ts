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

import type { Note } from "../core/types.js";

/** One item row as the UI renders it (cards + detail). Mirrors the subset of `Skill`
 *  the UI needs — kept here so host (env callbacks) and UI agree. Covers both kinds:
 *  `type` splits the Skills / Workflows tabs; `requiredSkills` (workflows only) are
 *  the prerequisite skill mint ids the detail view renders as clickable links. */
export interface SkillCard {
  id: string; // mint address
  type?: "skill" | "workflow";
  name: string;
  description?: string;
  category?: string;
  hashtags?: string[];
  image?: string | null; // txid / url / null (viewer infers; null -> default art)
  supply?: number; // popularity
  creator?: string; // wallet (paid on a priced buy)
  requiredSkills?: string[]; // workflows only: prerequisite skill mint ids
}

/** A full detail payload for one item: its card, the on-chain body (skillText, read
 *  separately — not in the indexer), and — for a workflow — the cards of each required
 *  skill so the UI can render them as clickable rows that open their own detail.
 *  `notes` is fetched in the same round-trip so the detail view opens with comments. */
export interface SkillDetail {
  card: SkillCard;
  skillText: string | null; // the SKILL.md / workflow body (readSkillText)
  requiredCards: SkillCard[]; // resolved cards for requiredSkills (workflows)
  notes?: Note[]; // skill comments, newest-first (issue #34)
}

export type { Note };

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
  | { type: "searchSkills"; query: string; kind?: "skill" | "workflow" } // kind = the active tab
  | { type: "getSkillDetail"; mint: string } // open the detail view for one item
  | { type: "buySkill"; skillId: string; creatorWallet?: string }
  | { type: "ownedSkills" } // ask the host to (re)send the owned list
  | { type: "getBalance" } // ask the host for the wallet's native SOL balance
  | { type: "setHeliusKey" } // host opens a native input to capture + save the key
  | { type: "useDefaultRpc" } // clear any key, fall back to the default
  | { type: "getRpcStatus" } // ask the host to (re)send rpcStatus
  // issue #34: post a comment on a skill (holder-gated client-side)
  | { type: "postNote"; skillId: string; skillType?: "skill" | "workflow"; text: string; gitLink?: string };

// ── host -> UI (responses / pushes) ─────────────────────────────────────────
export type MarketEvent =
  | { type: "searchResults"; results: SkillCard[] }
  | { type: "searchError"; message: string } // search threw (RPC/DAS failure) — show why, don't hang
  | { type: "skillDetail"; detail: SkillDetail } // full detail for the opened item (includes notes)
  | { type: "buyResult"; skillId: string; ok: boolean; slug?: string; error?: string }
  | { type: "ownedSkills"; names: string[] } // installed skill names (panel fill)
  | { type: "balance"; lamports: number | null } // wallet SOL balance (null = read failed)
  | { type: "skillActive"; name: string } // a skill fired -> "Casting <name>" cue
  | { type: "rpcStatus"; status: RpcStatus } // DAS-ready? which source? (issue #23)
  // issue #34: comment write result + refreshed comment list
  | { type: "postNoteResult"; skillId: string; ok: boolean; error?: string }
  | { type: "notes"; skillId: string; notes: Note[] };

export type MarketMessage = MarketRequest | MarketEvent;
