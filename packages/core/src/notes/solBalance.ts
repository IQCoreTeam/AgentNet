// SOL (native lamport) balance — for the OFF-mode skill-shopping funds gate (issue #21).
//
// NOTE: this is DIFFERENT from getBalance() in balance.ts. That reads a wallet's
// per-skill-mint SPL token amount (Token-2022 ATA). This reads the wallet's native
// SOL balance via conn.getBalance — the right call to decide whether someone can
// afford a priced buy before we ever surface a "buy this?" suggestion.

import { PublicKey, type Connection } from "@solana/web3.js";

// Network tx-fee buffer (lamports). The 6.9% protocol fee (PR #22) is taken OUT of the
// item price on-chain — the buyer pays exactly `price` plus the network tx fee, NOT
// price + 6.9%. So the only headroom we need beyond price is the signature fee.
export const TX_FEE_BUFFER_LAMPORTS = 5000;

/** Native SOL balance of a wallet, in lamports. */
export async function getSolBalance(conn: Connection, pubkey: string): Promise<number> {
  return conn.getBalance(new PublicKey(pubkey));
}

/**
 * True if the wallet can afford a priced buy: SOL >= price + tx-fee buffer.
 * Used to funds-gate the OFF-mode "buy this?" suggestion — never nag an empty wallet.
 */
export async function canAffordSkill(
  conn: Connection,
  pubkey: string,
  priceLamports: number,
): Promise<boolean> {
  const balance = await getSolBalance(conn, pubkey);
  return balance >= priceLamports + TX_FEE_BUFFER_LAMPORTS;
}
