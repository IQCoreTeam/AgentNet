// SkillSource — the enumeration seam for "which skills/workflows exist".
//
// skill-nft-structure.md §2 is emphatic: "No skills registry table. The NFT
// collection IS the skill list." The canonical truth is each mint's on-chain
// TokenMetadata (uri + category/hashtags traits) + its `supply`. But there is no
// collection/group primitive on these standalone Token-2022 mints yet, so the
// chain cannot be *enumerated* directly — DAS getAssetsByGroup needs a grouping
// key we don't mint. Until that lands, an off-chain index supplies the SET of
// mint ids.
//
// So `skills:index` is NOT the registry of truth — it is a rebuildable
// CacheLayer (coding-info.md §⑤: "a cache/index that can be rebuilt anytime;
// data stays on-chain"). This interface makes that explicit and swappable: today
// it's backed by the index table; a DAS/gateway enumerator can replace it later
// without changing search or reputation. Drift-prone fields (supply, and traits
// when verification is requested) are re-read from the mint by the consumer, so
// the cache only ever provides the id set + a fast metadata snapshot.

import { readRows } from "./chain.js";
import { SKILLS_INDEX_HINT } from "./seed.js";
import type { Skill } from "./types.js";

export interface SkillSource {
  /** Enumerate all known skills/workflows (id set + cached metadata snapshot). */
  listSkills(limit?: number): Promise<Skill[]>;
}

/**
 * Default source — reads the `skills:index` CacheLayer table.
 *
 * `readTableRows` also returns non-row entries (metadata-shaped {signature,
 * metadata, data} payloads). A real indexed row always has a string `id`; the
 * metadata entries do not — so `id` is the row-vs-metadata discriminator.
 * (Consumers must still tolerate other fields being absent.)
 */
export const indexTableSource: SkillSource = {
  async listSkills(limit = 1000): Promise<Skill[]> {
    const rows = await readRows(SKILLS_INDEX_HINT, { limit });
    return (rows as unknown as Skill[]).filter((s) => typeof s.id === "string");
  },
};
