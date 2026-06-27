// Domain types shared across every module.
//
// We do NOT re-declare a signer type. `SignerInput` from iqlabs-sdk already
// covers Node `Keypair`, web3.js `Signer`, and browser `WalletSigner`, so we
// just re-export it.

export type { SignerInput } from "@iqlabs-official/solana-sdk/utils";

/** Session metadata row stored in `mysessions/[wallet]`. */
export interface Session {
  sessionId: string;
  modelType: "claude" | "codex";
  createdAt: number;
  updatedAt: number;
  title?: string;
}

/** Skill NFT metadata. */
export interface Skill {
  id: string; // NFT mint address
  type?: "skill" | "workflow"; // distinguishes between skills and workflows in search
  name: string;
  description: string;
  creator: string; // wallet address
  category: string;
  hashtags?: string[];
  // Workflows only: the prerequisite skill mint ids (the repeated `requiredSkill`
  // traits, skill-nft-json.md §4b). Empty/absent for a plain skill. Carried on
  // Skill so an enumeration result is enough to compute "what can I unlock".
  requiredSkills?: string[];
  price?: string; // lamports as decimal string (bigint isn't JSON-serializable)
  supply: number; // mint supply = popularity
  uriTxid: string; // codeIn txid holding the skill text
  createdAt: number;
}

/** Workflow NFT metadata — a skill bundle with gates. */
export interface Workflow {
  id: string; // NFT mint address
  type?: "skill" | "workflow";
  name: string;
  description: string;
  creator: string;
  requiredSkills: string[]; // skill mint addresses required to unlock
  createdAt: number;
}

/**
 * Note (comment) on `notes/[skillNFT]` or `notes/[agentWallet]`.
 *
 * STORED columns: id · author · text · gitLink? · timestamp · meta?. The
 * `subject` (= the table key) and `isSelfNote` (= author == subject) are NOT
 * stored — they're derived at read time (notes.md §3 "no flag, derive from
 * author"), so they're optional here and only present on read results.
 */
export interface Note {
  id: string; // unique id (author + timestamp + nonce)
  author: string; // wallet address
  text: string;
  title?: string; // optional post title (blog/comment)
  gitLink?: string; // optional github/on-chain-git link (URL tells on/off-chain)
  image?: string; // optional image (https link or on-chain ref; viewer resolves via gateway)
  timestamp: number;
  meta?: Record<string, unknown>; // optional free-form extras (one column, JSON)
  subject?: string; // derived on read: the table key (skill mint / agent wallet)
  isSelfNote?: boolean; // derived on read: author == subject (owner post)
}

/**
 * Agent reputation snapshot stored in `reputation:<wallet>` table.
 *
 * NOT a computed score (notes.md: "Not a rating/score"). Standing = `totalSupply`
 * — "famous agent = sum of supply across the skills that agent created"
 * (skill-nft-structure.md). `notesReceived` is informational only.
 */
export interface Reputation {
  wallet: string;
  skillsPublished: number;
  totalSupply: number; // sum of on-chain supply across agent's skills = fame
  notesReceived: number; // informational count, never a score
  // Summed verified-work GitHub stars across the agent's registered repos. Optional +
  // display-only: a reputation axis distinct from totalSupply (popularity). Attached by
  // listAgents (best-effort) and absent on hosts that don't fetch work-links.
  stars?: number;
  // Net lamports the agent has earned from skill sales: SUM price x (supply-1) x (1 - FEE_BPS)
  // over their created skills (supply-1 drops the creator's own publish self-mint; fee comes out
  // of the price). Decimal string (lamports; bigint isn't JSON-serializable). Optional +
  // display-only; 0 when prices are unavailable (das fallback) or every skill is free.
  totalEarned?: string;
  updatedAt: number;
}

/** Generic row type for table reads. */
export type Row = Record<string, unknown>;

/** Read options for table queries. */
export interface ReadOptions {
  limit?: number;
  before?: string;
}
