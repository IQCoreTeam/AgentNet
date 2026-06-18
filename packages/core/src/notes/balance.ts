// Check token balance for gating (notes, reputation, etc).

import { PublicKey, type Connection } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  getAccount,
  TokenAccountNotFoundError,
} from "@solana/spl-token";

const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPvZeJ");

// Flaky public RPCs (e.g. api.devnet.solana.com, the fallback when no working
// Helius key is set) load-balance across nodes, some of which lag and report a
// real ATA as "not found". A single such read made getBalance return 0 →
// postNote rejected a legit holder with "Must own ≥1 skill token (balance: 0)".
// So we don't trust ONE not-found: re-read a few times before concluding zero.
// Holders confirm on a retry; genuine non-owners just pay a small extra latency
// on a write they can't make anyway (the UI gates the input on ownership first).
const READ_ATTEMPTS = 3;
const RETRY_DELAY_MS = 300;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function getBalance(
  conn: Connection,
  skillMint: PublicKey,
  wallet: PublicKey,
): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(
    skillMint,
    wallet,
    false,
    TOKEN_2022_PROGRAM_ID,
  );
  let lastErr: unknown;
  for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
    if (attempt > 0) await delay(RETRY_DELAY_MS * attempt);
    try {
      const account = await getAccount(conn, ata, "confirmed", TOKEN_2022_PROGRAM_ID);
      return account.amount;
    } catch (err) {
      lastErr = err;
      // "not found" may be a genuine zero OR a lagging node — retry to be sure.
      // Other errors (rate limit, network, unauthorized RPC) are also transient
      // enough to retry; only after exhausting attempts do we surface them.
    }
  }
  if (lastErr instanceof TokenAccountNotFoundError) return 0n;
  throw lastErr;
}
