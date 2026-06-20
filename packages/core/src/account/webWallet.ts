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
// signTransaction is on-chain (Track 2): the secret key is in the wallet app, so this
// can't sign locally. The caller passes a `signTx` that round-trips the serialized tx to
// the wallet (browser provider / Android MWA) over the transport and returns the signed
// bytes. Without one (CLI/tests build a keypairWallet instead) it still throws.

import { PublicKey, Transaction, type VersionedTransaction } from "@solana/web3.js";
import type { Wallet } from "../runtime/contract.js";

// The exact message deriveX25519Keypair signs internally. The front-end MUST sign these
// same bytes (TextEncoder().encode(SESSION_KEY_MESSAGE)) so the derived key matches —
// a different message → a different key → the wallet can't read its own sessions.
export const SESSION_KEY_MESSAGE = "iq-sdk-derive-encryption-key-v1";

// Base58-encode a raw 32-byte ed25519 public key into a Solana address string. Used by
// the Android MWA path, which gets the pubkey as raw bytes over the native bridge and
// needs the same base58 string the backend will parse back via `new PublicKey(address)`.
// Encoding here (same @solana/web3.js) guarantees that round-trip matches exactly.
export function pubkeyToAddress(pubkey: Uint8Array): string {
  return new PublicKey(pubkey).toBase58();
}

export async function providerSignBase64(
  txBase64: string,
  sign: (tx: Transaction) => Promise<Transaction>,
): Promise<string> {
  const bytes = Uint8Array.from(atob(txBase64), (ch) => ch.charCodeAt(0));
  const signed = await sign(Transaction.from(bytes));
  return btoa(String.fromCharCode(...signed.serialize()));
}

// address: base58 from the connected wallet (provider.publicKey.toString()).
// sessionKeySig: the wallet's signature over SESSION_KEY_MESSAGE's bytes.
export function webWallet(
  address: string,
  sessionKeySig: Uint8Array,
  signTx?: (txBase64: string) => Promise<string>,
): Wallet {
  const expected = new TextEncoder().encode(SESSION_KEY_MESSAGE);
  const sameBytes = (a: Uint8Array, b: Uint8Array) =>
    a.length === b.length && a.every((v, i) => v === b[i]);

  async function roundTrip<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (!signTx) {
      throw new Error("on-chain signing not wired through the web wallet yet (Track 2).");
    }
    if ("version" in tx) {
      throw new Error("versioned transaction signing is not wired through the web wallet yet.");
    }
    // Preserve partial signatures already added by mint/minter keypairs before wallet signing.
    const unsigned = (tx as Transaction).serialize({ requireAllSignatures: false }).toString("base64");
    return Transaction.from(Buffer.from(await signTx(unsigned), "base64")) as T;
  }

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
    signTransaction: roundTrip,
    async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
      const signed: T[] = [];
      for (const tx of txs) signed.push(await roundTrip(tx));
      return signed;
    },
  };
}
