// One-time backfill for the issue #203 table split. Posts written before the
// split live in reviews:agent:[wallet] as top-level self-notes; this rewrites
// each into blog:agent:[wallet] PRESERVING the stored row (same id, same
// timestamp), so every comment:blog:[postId] table stays attached, and mirrors
// the new write into the feed anchor so old posts join the global feed.
//
// Forward-only by default: NOTHING calls this automatically. A host (or a
// REPL) runs it once over the known agent list when the operator decides old
// posts should surface in the feed. The chain is append-only, so the old
// reviews rows are never deleted; every reader dedupes by id with the blog
// row winning, which also makes this function idempotent (a re-run skips ids
// already present in the blog table).

import { readRows, writeRow, ensureTable, feedPda } from "../core/chain.js";
import { reviewsAgentHint, blogAgentHint, FEED_BLOG_HINT, REVIEW_COLUMNS } from "../core/seed.js";
import type { Row, SignerInput } from "../core/types.js";

export interface BlogMigrationResult {
  wallet: string;
  migrated: number; // posts rewritten into blog:agent this run
  skipped: number; // posts already present in blog:agent (idempotent re-run)
}

/** A stored row is a migratable post when it is the wallet's own top-level
 *  self-note: author == wallet and no meta.parentId (replies stay behind,
 *  threaded under their reviews:agent parents). */
function isTopLevelSelfNote(row: Row, wallet: string): boolean {
  const r = row as { id?: unknown; author?: unknown; meta?: { parentId?: unknown } };
  return typeof r.id === "string" && r.author === wallet && r.meta?.parentId === undefined;
}

/** Rebuild the exact stored shape: gateway reads decorate rows (__txSignature
 *  and friends) and writeRow rejects any key outside the declared columns, so
 *  only REVIEW_COLUMNS keys survive into the rewritten row. */
function storedShape(row: Row): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of REVIEW_COLUMNS) {
    const v = (row as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Backfill the given agents' pre-split posts into their blog:agent tables,
 * one write per moved post, each mirrored into the feed anchor in the same
 * transaction. Sequential on purpose: a handful of rows for a handful of
 * agents, and ordered writes keep the tx flow predictable for a wallet signer.
 */
export async function migrateBlogPosts(
  signer: SignerInput,
  agentWallets: string[],
): Promise<BlogMigrationResult[]> {
  const results: BlogMigrationResult[] = [];
  for (const wallet of agentWallets) {
    const blogHint = blogAgentHint(wallet);
    const [reviewRows, blogRows] = await Promise.all([
      readRows(reviewsAgentHint(wallet), { limit: 500 }),
      readRows(blogHint, { limit: 500 }),
    ]);
    const existing = new Set(
      blogRows.map((r) => (r as { id?: unknown }).id).filter((id): id is string => typeof id === "string"),
    );
    const posts = reviewRows.filter((r) => isTopLevelSelfNote(r, wallet));

    let migrated = 0;
    let skipped = 0;
    for (const row of posts) {
      if (existing.has((row as { id: string }).id)) {
        skipped++;
        continue;
      }
      if (migrated === 0) await ensureTable(signer, blogHint, REVIEW_COLUMNS, "id");
      await writeRow(signer, blogHint, JSON.stringify(storedShape(row)), [feedPda(FEED_BLOG_HINT)]);
      migrated++;
    }
    results.push({ wallet, migrated, skipped });
  }
  return results;
}
