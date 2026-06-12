// KeyPolicy — the LIFETIME of the session encryption key, separate from how it's
// derived (crypto.ts) and from where the wallet comes (Wallet impls). The session
// key is deterministic (same wallet → same key), so "not stored" never means "data
// lost" — re-deriving from the wallet reproduces it. The only question a policy
// answers is: keep it in memory for this run, or persist it so the next run skips
// the wallet signature?
//
//   ephemeralKey()  — memory only; cleared on disconnect/exit. The safe default:
//                     the key (a master secret for all sessions) never touches disk.
//                     Cost: one wallet signature per process start.
//   persistedKey()  — read from a device secure store first; derive + save on miss.
//                     The "local storage mode" toggle. Needs a KeyVault (Android
//                     Keystore / OS keychain) — added when a surface supplies one.
//
// SessionStore depends only on this interface, so flipping the toggle is swapping the
// policy at construction — no change to storage, crypto, or the dispatcher.

import type { Wallet } from "../runtime/contract.js";
import { deriveSessionKey, type SessionKey } from "../core/crypto.js";

export interface KeyPolicy {
  // Obtain the session key for this wallet, applying the policy's caching/persistence.
  getKey(wallet: Wallet): Promise<SessionKey>;
  // Forget the cached key (disconnect/logout). After this, getKey re-obtains it.
  // NOTE: today disconnect rebuilds the runtime (new SessionStore → new policy), so
  // an ephemeral key is already dropped without calling this. clear() is the explicit
  // path for when a surface keeps one store across logins (e.g. the persisted toggle
  // wiping the in-memory copy while the vault entry stays) — wired when that lands.
  clear(): void;
}

// Memory-only: derive once per process, cache, drop on clear(). Current behavior,
// now with an explicit clear() so disconnect actually forgets the key.
export function ephemeralKey(): KeyPolicy {
  let key: SessionKey | undefined;
  return {
    async getKey(wallet) {
      if (!key) key = await deriveSessionKey(wallet);
      return key;
    },
    clear() {
      key = undefined;
    },
  };
}

// A device secure store for the persisted policy. A surface implements this over its
// platform keystore (Android Keystore, macOS Keychain, …). Stores the whole SessionKey
// (priv + pubHex) under the wallet address, so reading it back needs no re-derivation.
// NO browser/localStorage implementation — that wouldn't be a secure store.
export interface KeyVault {
  read(address: string): Promise<SessionKey | null>;
  write(address: string, key: SessionKey): Promise<void>;
  remove(address: string): Promise<void>;
}

// Persisted: reuse the stored key if present (no signature prompt), else derive and
// save. Implemented now because the policy seam needs both arms to be real; it stays
// dormant until a surface passes a KeyVault.
export function persistedKey(vault: KeyVault): KeyPolicy {
  let key: SessionKey | undefined;
  return {
    async getKey(wallet) {
      if (key) return key;
      key = (await vault.read(wallet.address)) ?? undefined;
      if (!key) {
        key = await deriveSessionKey(wallet);
        await vault.write(wallet.address, key);
      }
      return key;
    },
    clear() {
      key = undefined;
    },
  };
}
