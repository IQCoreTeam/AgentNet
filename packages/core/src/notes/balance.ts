// Check token balance for gating (notes, reputation, etc).

import { PublicKey, type Connection } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  getAccount,
  TokenAccountNotFoundError,
} from "@solana/spl-token";

const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPvZeJ");

export async function getBalance(
  conn: Connection,
  skillMint: PublicKey,
  wallet: PublicKey,
): Promise<bigint> {
  try {
    const ata = getAssociatedTokenAddressSync(
      skillMint,
      wallet,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    const account = await getAccount(conn, ata, "confirmed", TOKEN_2022_PROGRAM_ID);
    return account.amount;
  } catch (err) {
    if (err instanceof TokenAccountNotFoundError) {
      return 0n;
    }
    throw err;
  }
}
