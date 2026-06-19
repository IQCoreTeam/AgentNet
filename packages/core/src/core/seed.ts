// The single source of truth for table_hint strings.
//
// Readers re-derive PDAs with `iqlabs.utils.toSeedBytes(hint)` →
// `iqlabs.contract.getTablePda(...)`; writers pass the same hint into
// `iqlabs.writer.createTable`. Keeping the naming convention in one place
// prevents silent drift between writer and reader.

import type { MarketItemType } from "./types.js";

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
 * The collection is the umbrella (skills / workflows / plugins / future kinds); the NFT
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
 * Best-effort network of a Solana RPC endpoint, inferred from its host. A registered or
 * custom RPC (a Helius key, an env override, a self-hosted node) can target a different
 * network than the static NETWORK switch — and when it does, the gateway has to follow
 * the RPC, or code-in reads hit the wrong network and come back blank. Callers that hold
 * the live connection pass conn.rpcEndpoint here so the gateway auto-matches it. An
 * unrecognized host falls back to the static switch.
 */
export function networkFromRpcUrl(url: string | null | undefined): Network {
  const u = (url ?? "").toLowerCase();
  if (u.includes("mainnet")) return "mainnet";
  if (u.includes("devnet")) return "devnet";
  return getNetwork();
}

/**
 * Off-chain service endpoints, grouped per network — the ONE place to swap a URL.
 * Everything network-shaped (gateway, NFT indexer, public RPC) lives here, so flipping
 * NETWORK above (or a per-service env var) retargets the whole app. Mirrors the on-chain
 * ids block below: a single source means no hardcoded URL drifts out of sync.
 *
 * The gateway in particular MUST match the network — a mainnet gateway returns empty
 * data for a devnet tx, so a devnet skill body silently goes blank. Keeping the dev/main
 * split visible in one table is what stops that class of bug from reappearing.
 * (The indexer currently serves both networks from one host; split it here if that changes.)
 */
export const ENDPOINTS: Record<Network, { gateway: string; indexer: string; publicRpc: string }> = {
  devnet: {
    gateway: "https://dev-gateway.iqlabs.dev",
    indexer: "https://nft-index.iqlabs.dev",
    publicRpc: "https://api.devnet.solana.com",
  },
  mainnet: {
    gateway: "https://gateway.iqlabs.dev",
    indexer: "https://nft-index.iqlabs.dev",
    publicRpc: "https://api.mainnet-beta.solana.com",
  },
};

/**
 * The IQLabs gateway that resolves a code-in inscription (a tx signature) into its
 * content, matched to a network (see ENDPOINTS). Pass the network of the RPC actually in
 * use — derive it with networkFromRpcUrl(conn.rpcEndpoint) — so the gateway follows the
 * live connection rather than the static switch; defaults to the static network when no
 * connection context is available. Env override (AGENTNET_GATEWAY_URL) always wins.
 */
export function getGatewayUrl(network: Network = getNetwork()): string {
  return process.env.AGENTNET_GATEWAY_URL || ENDPOINTS[network].gateway;
}

/**
 * The NFT indexer (agentnet-nft-indexer) base URL — the primary read path for the
 * skill/workflow catalog (it serves /items with supply + traits already filled).
 * Env override (AGENTNET_INDEXER_URL) wins for a self-hosted indexer.
 */
export function getIndexerUrl(): string {
  return process.env.AGENTNET_INDEXER_URL || ENDPOINTS[getNetwork()].indexer;
}

/**
 * Public Solana RPC for the active network (standard JSON-RPC, NO DAS). rpc.ts uses this
 * as the fallback when no Helius key is set — or when a stored key is dead — so chain
 * reads keep working off the public endpoint.
 */
export function getPublicRpcUrl(): string {
  return ENDPOINTS[getNetwork()].publicRpc;
}

/** Devnet test ids — the single source. Swap here (or via env) to retarget. */
export const SKILLS_COLLECTION_MINT = "5TPKvxXTpPVFrj9MUnFUr6XiGFEdtetsTvwRh6bKQ9Qg";
export const WORKFLOWS_COLLECTION_MINT = "F474VEn2uevpCotRqrPEbZ4XvWyqrqL4iGmNnmp9zvNe";
// Placeholder until the plugin umbrella collection is minted. Override with
// AGENTNET_PLUGINS_COLLECTION_PUBKEY when testing a real plugin collection.
export const PLUGINS_COLLECTION_MINT = "";
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

/**
 * The TokenGroup mint plugins are enrolled into. Env override wins; otherwise
 * null until the plugin collection is minted for the target network.
 */
export function getPluginsCollectionMint(): string | null {
  return process.env.AGENTNET_PLUGINS_COLLECTION_PUBKEY || PLUGINS_COLLECTION_MINT || null;
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
 * "skill" / "workflow" / "plugin" → its collection. Every item of a given type
 * shares the same collection. New kinds get a branch here, nowhere else.
 *
 * Returns "" when the collection isn't configured yet — reviewsHint still
 * produces a stable key, so reads/writes work before bootstrap.
 */
export function collectionFor(type: MarketItemType | undefined): string {
  if (type === "workflow") return getWorkflowsCollectionMint() ?? "";
  if (type === "plugin") return getPluginsCollectionMint() ?? "";
  return getSkillsCollectionMint() ?? "";
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
