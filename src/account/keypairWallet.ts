// Build a full Wallet from a Solana Keypair. Satisfies BOTH capabilities:
//   - signMessage  (ed25519 detached sig → session encryption key)
//   - WalletSigner (publicKey + signTransaction/signAllTransactions → on-chain)
// Used by tests, the CLI (local key), and any non-interactive signer. Interactive
// front-ends (Phantom/mobile) implement Wallet directly instead of via a Keypair.

import { Keypair, type Transaction, type VersionedTransaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import type { Wallet } from "../runtime/contract.js";

export function keypairWallet(kp: Keypair): Wallet {
  return {
    address: kp.publicKey.toBase58(),
    publicKey: kp.publicKey,
    async signMessage(msg) {
      return nacl.sign.detached(msg, kp.secretKey);
    },
    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
      if ("version" in tx) (tx as VersionedTransaction).sign([kp]);
      else (tx as Transaction).partialSign(kp);
      return tx;
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
      for (const tx of txs) {
        if ("version" in tx) (tx as VersionedTransaction).sign([kp]);
        else (tx as Transaction).partialSign(kp);
      }
      return txs;
    },
  };
}

// Deterministic test wallet from a seed byte (same seed → same key everywhere).
export function testWallet(seed = 7): Wallet {
  return keypairWallet(Keypair.fromSeed(new Uint8Array(32).fill(seed)));
}
