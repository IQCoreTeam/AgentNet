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
 * Hint for notes on a skill NFT.
 * input:  skill NFT mint address (base58)
 * output: "notes:<skillNFT>"
 */
export function notesSkillHint(skillNFT: string): string {
  return `notes:skill:${skillNFT}`;
}

/**
 * Hint for notes (comments + self-posts) on an agent wallet.
 * input:  agent wallet address (base58)
 * output: "notes:<agentWallet>"
 */
export function notesAgentHint(agentWallet: string): string {
  return `notes:agent:${agentWallet}`;
}

/**
 * Skill/workflow discovery index. Per search.md the canonical source is the
 * skill *collection* (scan the NFTs by trait), but until DAS/collection-scan is
 * wired this table is the registry that publish writes to and search/reputation
 * read from. Kept SEPARATE from the audit table — they hold different things.
 */
export const SKILLS_INDEX_HINT = "skills:index";

/**
 * Table for audit/validation records (the "Q-table" in search.md) — security
 * check results shown ALONGSIDE search results. NOT the skill registry.
 */
export const AUDIT_HINT = "audit:skills";

/**
 * Hint for per-wallet reputation snapshot.
 * input:  wallet address (base58)
 * output: "reputation:<wallet>"
 */
export function reputationHint(wallet: string): string {
  return `reputation:${wallet}`;
}

// ===== Table column declarations =====
//
// The SDK's writeRow validates every row key against the table's declared
// columns (`unknown key: <k>` otherwise), so these MUST be the full superset of
// every key any writer puts in a row. Skills and workflows share the index
// table, so SKILLS_INDEX_COLUMNS is the union of both row shapes — whoever
// publishes first creates the table, and the other type's keys must still pass.

export const SKILLS_INDEX_COLUMNS = [
  "id",
  "name",
  "description",
  "creator",
  "category",
  "hashtags",
  "type",
  "requiredSkills", // workflow-only
  "price",
  "supply",
  "uriTxid",
  "createdAt",
];

export const NOTE_COLUMNS = [
  "id",
  "author",
  "subject",
  "text",
  "gitLink",
  "isSelfNote",
  "timestamp",
];

// Reputation is NOT a score (notes.md: "Not a rating/score"). An agent's
// standing = totalSupply (skill-nft-structure.md: "famous agent = sum of supply
// across the skills that agent created"). notesReceived is informational only.
export const REPUTATION_COLUMNS = [
  "wallet",
  "skillsPublished",
  "totalSupply",
  "notesReceived",
  "updatedAt",
];
