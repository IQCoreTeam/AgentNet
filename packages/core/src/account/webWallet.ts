// Build a Wallet from a browser/mobile wallet (Phantom, Solflare, Backpack, …), the
// web counterpart of keypairWallet. Wallet-agnostic by construction: it takes only an
// address + a signature, so any wallet that can sign the session-key message works the
// same — the front-end picks which provider; this never knows or cares which one.
// The secret key lives in the user's wallet app, never here — so this can't sign on
// its own. Instead the front-end signs the ONE fixed message the session-key
// derivation needs (deriveX25519Keypair's "iq-sdk-derive-encryption-key-v1") and hands
// us that signature; we replay it.
//
// Why a single cached signature is enough: deriveX25519Keypair is the only caller of
// Wallet.signMessage in this codebase, and it always signs that one fixed message. So
// the wallet need prompt the user exactly once (at connect), and every later session
// reuses the cached signature — no round-trip to the wallet per message.
//
// signTransaction is on-chain (Track 2) and isn't wired through the browser yet; it
// throws rather than fake-succeed. When the on-chain layer reaches the web surface,
// fill it by round-tripping to window.solana.signTransaction over the transport.

import { PublicKey, type Transaction, type VersionedTransaction } from "@solana/web3.js";
import type { Wallet } from "../runtime/contract.js";

// The exact message deriveX25519Keypair signs internally. The front-end MUST sign these
// same bytes (TextEncoder().encode(SESSION_KEY_MESSAGE)) so the derived key matches —
// a different message → a different key → the wallet can't read its own sessions.
export const SESSION_KEY_MESSAGE = "iq-sdk-derive-encryption-key-v1";

// address: base58 from the connected wallet (provider.publicKey.toString()).
// sessionKeySig: the wallet's signature over SESSION_KEY_MESSAGE's bytes.
export function webWallet(address: string, sessionKeySig: Uint8Array): Wallet {
  const expected = new TextEncoder().encode(SESSION_KEY_MESSAGE);
  const sameBytes = (a: Uint8Array, b: Uint8Array) =>
    a.length === b.length && a.every((v, i) => v === b[i]);

  return {
    address,
    publicKey: new PublicKey(address),
    async signMessage(msg) {
      // Only the session-key message is pre-signed. Any other message would need a
      // live wallet round-trip we don't do — and nothing else calls this today.
      if (!sameBytes(msg, expected)) {
        throw new Error("webWallet only signs the session-key message (no live signMessage round-trip).");
      }
      return sessionKeySig;
    },
    async signTransaction<T extends Transaction | VersionedTransaction>(_tx: T): Promise<T> {
      throw new Error("on-chain signing not wired through the web wallet yet (Track 2).");
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(_txs: T[]): Promise<T[]> {
      throw new Error("on-chain signing not wired through the web wallet yet (Track 2).");
    },
  };
}
