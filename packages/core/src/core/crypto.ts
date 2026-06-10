// Encryption for session blobs — built on iqlabs crypto, no new crypto here.
// Key is derived from the wallet signature (same wallet → same key on any device),
// so only the wallet can decrypt its own sessions.

import {
  deriveX25519Keypair,
  dhEncrypt,
  dhDecrypt,
  bytesToHex,
} from "@iqlabs-official/solana-sdk/crypto";
import type { Wallet } from "../runtime/contract.js";

export interface SessionKey {
  privKey: Uint8Array;
  pubHex: string;
}

// deriveX25519Keypair signs its OWN fixed message internally (deterministic),
// so we hand it the wallet's signMessage directly. Same wallet → same key,
// on any device → can decrypt its own sessions anywhere.
export async function deriveSessionKey(wallet: Wallet): Promise<SessionKey> {
  const { privKey, pubKey } = await deriveX25519Keypair(wallet.signMessage);
  return { privKey, pubHex: bytesToHex(pubKey) };
}

// Encrypt a session blob to the wallet itself (self-recipient).
// Returns a single bytes payload (JSON of the dh result) to hand to StorageAdapter.put.
export async function encryptForWallet(
  key: SessionKey,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const enc = await dhEncrypt(key.pubHex, plaintext);
  return new TextEncoder().encode(JSON.stringify(enc));
}

export async function decryptForWallet(
  key: SessionKey,
  payload: Uint8Array,
): Promise<Uint8Array> {
  const enc = JSON.parse(new TextDecoder().decode(payload)) as {
    senderPub: string;
    iv: string;
    ciphertext: string;
  };
  return dhDecrypt(key.privKey, enc.senderPub, enc.iv, enc.ciphertext);
}
