// Search skills by keyword, category, hashtags; sort by supply or recency.

import type { Connection } from "@solana/web3.js";
import { readRows } from "../core/chain.js";
import { AUDIT_HINT } from "../core/seed.js";
import type { Skill, Row } from "../core/types.js";
import { getMintSupply } from "../nft/token2022.js";

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
}

export async function searchSkills(
  conn: Connection,
  options?: SearchOptions,
): Promise<Skill[]> {
  const limit = options?.limit ?? 50;
  const sortBy = options?.sortBy ?? "supply";
  const filters = options?.filters ?? {};

  // Read all skills from audit table
  const rows = await readRows(AUDIT_HINT, { limit: 1000 });
  let skills = rows as unknown as Skill[];

  // Filter by keyword (name + description)
  if (filters.keyword) {
    const kw = filters.keyword.toLowerCase();
    skills = skills.filter(
      (s) =>
        s.name.toLowerCase().includes(kw) ||
        s.description.toLowerCase().includes(kw),
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
    skills.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sortBy === "recent") {
    skills.sort((a, b) => b.createdAt - a.createdAt);
  }

  return skills.slice(0, limit);
}
