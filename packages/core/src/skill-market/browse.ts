// browse_skills (plan §4) — the high-level L2 entry a surface (or the agent, via the
// skill-shopping workflow) calls to shop. It folds search + the code-side verify scan
// into one call and returns up to three candidates that cleared the scan, so a surface
// can show them and the agent can judge each body (step ②) before the user buys.
//
// Funds first: if the wallet can't afford to shop, we don't even search — never make an
// empty wallet browse a market it can't buy from (plan §5). browse returns DATA only;
// how it's shown (AskUserQuestion in chat vs. cards in the Markets UI) is the caller's
// job — no `forWhom` parameter.

import type { Connection } from "@solana/web3.js";
import type { Wallet } from "../runtime/contract.js";
import type { SkillCard } from "../chat/marketMessages.js";
import { searchSkills } from "../search/search.js";
import { getSolBalance } from "../notes/solBalance.js";
import { verifyOneSkill, type VerifyGuard } from "./index.js";

// Minimum SOL to bother shopping (plan §5/§6). A code constant for now (config-ize
// later — don't over-design). 0.1 SOL covers a typical priced buy + the tx fee.
export const MIN_SHOP_LAMPORTS = 100_000_000; // 0.1 SOL

// How many top candidates to recommend, and how many to verify before giving up (we
// verify from the top until this many pass, so we don't scan the whole result set).
const RECOMMEND = 3;

export type BrowseResult =
  | { ok: false; reason: "low_funds"; balanceSol: number; minSol: number }
  | { ok: false; reason: "no_results" }
  | { ok: false; reason: "none_safe"; checked: number }
  | { ok: true; recommendations: SkillCard[]; balanceSol: number };

const lamportsToSol = (l: number) => l / 1e9;

/**
 * Search the marketplace, code-scan candidates from the top until RECOMMEND have cleared,
 * and return those as recommendations (each already marked on the guard so `buy` will
 * accept it). The agent still judges each body against the verify rubric (step ②) before
 * surfacing a buy to the user.
 */
export async function browseSkills(
  conn: Connection,
  wallet: Wallet,
  guard: VerifyGuard,
  args: { query: string; category?: string },
): Promise<BrowseResult> {
  // 1. funds gate — before any search.
  const balance = await getSolBalance(conn, wallet.address);
  if (balance < MIN_SHOP_LAMPORTS) {
    return { ok: false, reason: "low_funds", balanceSol: lamportsToSol(balance), minSol: lamportsToSol(MIN_SHOP_LAMPORTS) };
  }

  // 2. search (supply-sorted by the search layer).
  const hits = await searchSkills(conn, { filters: { keyword: args.query, category: args.category, type: "skill" } });
  if (hits.length === 0) return { ok: false, reason: "no_results" };

  // 3. verify from the top until RECOMMEND pass (early-exit — don't scan them all).
  const recommendations: SkillCard[] = [];
  let checked = 0;
  for (const s of hits) {
    if (recommendations.length >= RECOMMEND) break;
    checked++;
    const r = await verifyOneSkill(conn, s.id, guard);
    if (r.ok) {
      recommendations.push({ id: s.id, name: s.name, description: s.description, supply: s.supply, creator: s.creator });
    }
  }

  // 4. nothing cleared the scan — say so plainly (never silently empty).
  if (recommendations.length === 0) return { ok: false, reason: "none_safe", checked };

  return { ok: true, recommendations, balanceSol: lamportsToSol(balance) };
}