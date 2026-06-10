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
  category: string; // category/hashtag trait
  price?: bigint; // lamports (0 = free)
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

/** Note (comment) row stored in `notes/[skillNFT]` or `notes/[agentWallet]`. */
export interface Note {
  id: string; // unique id (author + timestamp)
  author: string; // wallet address
  subject: string; // skill NFT address or agent wallet address
  text: string;
  gitLink?: string; // optional github/on-chain-git link
  isSelfNote?: boolean; // true if author == subject (owner post)
  timestamp: number;
}

/** Agent reputation snapshot stored in `reputation:<wallet>` table. */
export interface Reputation {
  wallet: string;
  skillsPublished: number;
  totalSupply: number; // sum of all buyer counts across agent's skills
  notesReceived: number;
  score: number; // derived: (totalSupply * 3) + (skillsPublished * 10) + notesReceived
  updatedAt: number;
}

/** Generic row type for table reads. */
export type Row = Record<string, unknown>;

/** Read options for table queries. */
export interface ReadOptions {
  limit?: number;
  before?: string;
}
