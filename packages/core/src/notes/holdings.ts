// Cached "which skill tokens does this wallet hold" — the single source of truth for
// note/comment write-gates. ONE getTokenAccountsByOwner call (ownedAssetIds) covers
// EVERY skill, cached per owner for a short TTL, so gating N comments in a session is
// 1 RPC call, not N per-mint reads. It is also the SAME source the owned-skills list
// uses, so the UI's "owned" badge and the write-gate can never disagree.
//
// Retry + last-good fallback: the fallback public devnet RPC (used when no working
// Helius key is set) is read-inconsistent — the same getTokenAccountsByOwner returned
// 0 then 13 — so a single empty/failed read must NOT falsely gate a real holder. We
// retry the one call, and if it keeps failing we reuse the last good set rather than
// locking the user out of commenting on a skill they own.

import { ownedAssetIds } from "../core/skillSource.js";

const TTL_MS = 60_000; // a buy invalidates explicitly; otherwise re-read after a minute
const ATTEMPTS = 3;
const RETRY_MS = 300;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const cache = new Map<string, { mints: Set<string>; at: number }>();

/**
 * The Token-2022 skill/NFT mints `owner` currently holds, cached per owner. Pass
 * `{ force: true }` to bypass the TTL (e.g. right after a buy). Throws only when the
 * RPC fails on every attempt AND there is no prior good set to fall back to.
 */
export async function heldSkillMints(
  owner: string,
  opts?: { force?: boolean },
): Promise<Set<string>> {
  const hit = cache.get(owner);
  if (!opts?.force && hit && Date.now() - hit.at < TTL_MS) return hit.mints;

  let lastErr: unknown;
  for (let i = 0; i < ATTEMPTS; i++) {
    if (i > 0) await delay(RETRY_MS * i);
    try {
      const mints = await ownedAssetIds(owner);
      // An empty result on a flaky node is indistinguishable from "owns nothing".
      // If we held something before, take one more read before trusting empty.
      if (mints.size === 0 && hit && hit.mints.size > 0 && i < ATTEMPTS - 1) continue;
      cache.set(owner, { mints, at: Date.now() });
      return mints;
    } catch (e) {
      lastErr = e;
    }
  }
  if (hit) return hit.mints; // reuse last good rather than falsely gating
  throw lastErr ?? new Error("could not resolve holdings");
}

/** Drop cached holdings (call after a buy so a freshly-acquired skill gates immediately). */
export function invalidateHeldMints(owner?: string): void {
  if (owner) cache.delete(owner);
  else cache.clear();
}
