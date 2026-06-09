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
 * Table for audit/validation records.
 * Stores results of skill security checks (pre-publish + periodic).
 */
export const AUDIT_HINT = "audit:skills";
