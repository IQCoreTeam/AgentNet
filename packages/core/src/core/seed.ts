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

// ===== On-chain program / collection ids (one place — easy to swap) =====
//
// Current values are the DEVNET test deployment. Override any of them with the
// matching env var when you point at a different network / collection. To move
// to mainnet, change NETWORK below + these three (and the program's constants.rs
// collection).

export type Network = "devnet" | "mainnet";

/**
 * The single network switch. Everything network-shaped (the default RPC, the Helius
 * endpoint, the UI badge) derives from this — flip it here (or AGENTNET_NETWORK) and
 * the whole app retargets. We're on devnet for testing.
 */
export const NETWORK: Network = "devnet";

/** The active network (env override wins). */
export function getNetwork(): Network {
  const n = process.env.AGENTNET_NETWORK;
  return n === "mainnet" || n === "devnet" ? n : NETWORK;
}

/**
 * The IQLabs gateway that resolves a code-in inscription (a tx signature) into its
 * content. It MUST match the network: the mainnet gateway can't resolve a devnet
 * tx, and vice versa — a mismatch returns empty data (the skill body goes blank).
 * Derived from getNetwork() so flipping the one switch retargets it; env override
 * (AGENTNET_GATEWAY_URL) still wins for a custom/self-hosted gateway.
 */
export function getGatewayUrl(): string {
  if (process.env.AGENTNET_GATEWAY_URL) return process.env.AGENTNET_GATEWAY_URL;
  return getNetwork() === "mainnet"
    ? "https://gateway.iqlabs.dev"
    : "https://dev-gateway.iqlabs.dev";
}

/** Devnet test ids — the single source. Swap here (or via env) to retarget. */
export const SKILLS_COLLECTION_MINT = "5TPKvxXTpPVFrj9MUnFUr6XiGFEdtetsTvwRh6bKQ9Qg";
export const WORKFLOWS_COLLECTION_MINT = "F474VEn2uevpCotRqrPEbZ4XvWyqrqL4iGmNnmp9zvNe";
/** agent-workflow-nft gate program — publish_workflow / buy_workflow. */
export const WORKFLOW_GATE_PROGRAM_ID = "3ptXj4yuaQG51WTA3SZZ37jGvYFgMhgXnSKWJLASJNkt";
/**
 * Protocol fee treasury. On every priced buy the gate program sends FEE_BPS of
 * the price here (out of the price — the buyer pays exactly `price`, the creator
 * nets the rest) and rejects any other treasury account. Must match the program's
 * constants.rs::FEE_TREASURY.
 */
export const FEE_TREASURY = "EWNSTD8tikwqHMcRNuuNbZrnYJUiJdKq9UXLXSEU4wZ1";

/**
 * The TokenGroup mint skills are enrolled into. Env override wins; otherwise the
 * configured devnet test collection.
 */
export function getSkillsCollectionMint(): string | null {
  return process.env.AGENTNET_SKILLS_COLLECTION_PUBKEY || SKILLS_COLLECTION_MINT;
}

/**
 * The TokenGroup mint workflows are enrolled into. Env override wins; otherwise
 * the configured devnet test collection.
 */
export function getWorkflowsCollectionMint(): string | null {
  return process.env.AGENTNET_WORKFLOWS_COLLECTION_PUBKEY || WORKFLOWS_COLLECTION_MINT;
}

/** The workflow gate program id (env override wins). */
export function getWorkflowGateProgramId(): string {
  return process.env.AGENTNET_WORKFLOW_GATE_PROGRAM_ID || WORKFLOW_GATE_PROGRAM_ID;
}

/** The protocol fee treasury (env override wins). */
export function getFeeTreasury(): string {
  return process.env.AGENTNET_FEE_TREASURY || FEE_TREASURY;
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
