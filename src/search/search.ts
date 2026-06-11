// Search skills by keyword, category, hashtags; sort by supply or recency.
//
// Enumeration goes through a SkillSource (core/skillSource.ts) — by default the
// `skills:index` CacheLayer, swappable for a DAS/gateway enumerator later. The
// mint stays the source of truth: `supply` is always hydrated from the mint, and
// with `verifyTraits` category/hashtags are re-read from on-chain metadata
// instead of the cached table copy.
//
// Per search.md the full design also has a SEMANTIC layer that maps a
// vocabulary-mismatch query onto an existing category/hashtag (e.g. "hotdog" →
// #convenience-store) via an off-chain embedding index (search.md §3). That
// embedding index is a separate off-chain component and is NOT built here — this
// module implements the on-chain half: trait filter + supply sort. Keyword match
// below is literal substring, not semantic.

import type { Connection } from "@solana/web3.js";
import type { Skill } from "../core/types.js";
import { indexTableSource, type SkillSource } from "../core/skillSource.js";
import { getMintSupply, readSkillMintMetadata } from "../nft/token2022.js";

export interface SearchFilters {
  keyword?: string;
  category?: string;
  hashtags?: string[];
  type?: "skill" | "workflow";
}

export type SortBy = "supply" | "name" | "recent";

export interface SearchOptions {
  filters?: SearchFilters;
  sortBy?: SortBy;
  limit?: number;
  /** Enumeration source. Defaults to the `skills:index` CacheLayer. */
  source?: SkillSource;
  /**
   * Re-read category/hashtags from each mint's on-chain TokenMetadata before
   * filtering, instead of trusting the cached index copy. Costs one extra RPC
   * per candidate; use when the table may be stale relative to the chain.
   */
  verifyTraits?: boolean;
}

export async function searchSkills(
  conn: Connection,
  options?: SearchOptions,
): Promise<Skill[]> {
  const limit = options?.limit ?? 50;
  const sortBy = options?.sortBy ?? "supply";
  const filters = options?.filters ?? {};
  // Default to the index-table CacheLayer. dasSource stays opt-in until the
  // Token-2022 getAssetsByGroup assumption is devnet-proven (see skillSource.ts).
  const source = options?.source ?? indexTableSource;

  let skills = await source.listSkills();

  // Optionally trust the chain over the cache for traits (category/hashtags).
  if (options?.verifyTraits) {
    await Promise.all(
      skills.map(async (s) => {
        const md = await readSkillMintMetadata(conn, s.id);
        if (md) {
          s.category = md.category ?? s.category;
          s.hashtags = md.hashtags ?? s.hashtags;
        }
      }),
    );
  }

  // Filter by keyword (name + description). Fields may be absent on a sparse
  // row, so coalesce before lowercasing.
  if (filters.keyword) {
    const kw = filters.keyword.toLowerCase();
    skills = skills.filter(
      (s) =>
        (s.name ?? "").toLowerCase().includes(kw) ||
        (s.description ?? "").toLowerCase().includes(kw),
    );
  }

  // Filter by category (exact)
  if (filters.category) {
    skills = skills.filter((s) => s.category === filters.category);
  }

  // Filter by hashtags (any match)
  if (filters.hashtags && filters.hashtags.length > 0) {
    skills = skills.filter((s) => {
      const skillHashtags = s.hashtags ?? [];
      return filters.hashtags!.some((tag) => skillHashtags.includes(tag));
    });
  }

  // Filter by type
  if (filters.type) {
    skills = skills.filter((s) => {
      // If type is not explicitly set in frontmatter, we treat it as a "skill"
      const t = s.type ?? "skill";
      return t === filters.type;
    });
  }

  // Hydrate live supply from the mint (indexed supply is stale — always 0).
  // Done after filtering so we only fetch for the matched set.
  if (sortBy === "supply") {
    await Promise.all(
      skills.map(async (s) => {
        s.supply = await getMintSupply(conn, s.id);
      }),
    );
  }

  // Sort
  if (sortBy === "supply") {
    skills.sort((a, b) => Number(b.supply) - Number(a.supply));
  } else if (sortBy === "name") {
    skills.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  } else if (sortBy === "recent") {
    skills.sort((a, b) => b.createdAt - a.createdAt);
  }

  return skills.slice(0, limit);
}
