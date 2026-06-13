// The single source of truth for table_hint strings.
//
// Readers re-derive PDAs with `iqlabs.utils.toSeedBytes(hint)` →
// `iqlabs.contract.getTablePda(...)`; writers pass the same hint into
// `iqlabs.writer.createTable`. Keeping the naming convention in one place
// prevents silent drift between writer and reader.

/** DbRoot id for every agentnet table. Bootstrap and every caller share this. */
export const AGENTNET_ROOT_ID = "agentnet-root";

/**
 * Hint for the per-wallet session list.
 * input:  wallet address (base58)
 * output: "mysessions:<wallet>"
 */
export function mysessionsHint(wallet: string): string {
  return `mysessions:${wallet}`;
}

/**
 * Hint for reviews on an item NFT inside a collection.
 *
 * The collection is the umbrella (skills / workflows / future kinds); the NFT
 * mint is the individual item under it. Keying by collection THEN item keeps
 * reviews partitioned per umbrella, so a new collection kind extends the same
 * structure without a new table shape.
 *
 * input:  collection mint (base58), item NFT mint (base58)
 * output: "reviews:<collectionId>:<nft>"
 */
export function reviewsHint(collectionId: string, nft: string): string {
  return `reviews:${collectionId}:${nft}`;
}

/**
 * Hint for reviews (comments + self-posts) on an agent wallet.
 * input:  agent wallet address (base58)
 * output: "reviews:agent:<agentWallet>"
 */
export function reviewsAgentHint(agentWallet: string): string {
  return `reviews:agent:${agentWallet}`;
}

/**
 * Table for audit/validation records (the "Q-table" in search.md) — security
 * check results shown ALONGSIDE search results, partitioned per collection.
 *
 * input:  collection mint (base58)
 * output: "audit:<collectionId>"
 */
export function auditHint(collectionId: string): string {
  return `audit:${collectionId}`;
}

/**
 * Returns the configured TokenGroup mint for skills, if any.
 * This is the umbrella collection that new skills are enrolled into.
 */
export function getSkillsCollectionMint(): string | null {
  return process.env.AGENTNET_SKILLS_COLLECTION_PUBKEY || null;
}

/**
 * Returns the configured TokenGroup mint for workflows, if any.
 * This is the umbrella collection that new workflows are enrolled into.
 */
export function getWorkflowsCollectionMint(): string | null {
  return process.env.AGENTNET_WORKFLOWS_COLLECTION_PUBKEY || null;
}

/**
 * The umbrella collection mint for an item type — the ONE place that maps
 * "skill" / "workflow" → its collection. There are only these two collections;
 * every item of a given type shares the same collection (a skill is one big
 * collection, a workflow another). New kinds get a branch here, nowhere else.
 *
 * Returns "" when the collection isn't configured yet — reviewsHint still
 * produces a stable key, so reads/writes work before bootstrap.
 */
export function collectionFor(type: "skill" | "workflow" | undefined): string {
  return (type === "workflow" ? getWorkflowsCollectionMint() : getSkillsCollectionMint()) ?? "";
}

// ===== Table column declarations =====
//
// The SDK's writeRow validates every row key against the table's declared
// columns (`unknown key: <k>` otherwise), so these MUST be the full superset of
// every key any writer puts in a review row.

// Trimmed per notes.md: `subject` is the table key (not stored) and
// `isSelfNote` is derived (author == subject) at read time. `meta` is one
// optional column holding a JSON blob for future/experimental fields.
export const REVIEW_COLUMNS = [
  "id",
  "author",
  "text",
  "gitLink",
  "timestamp",
  "meta",
];
