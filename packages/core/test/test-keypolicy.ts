// KeyPolicy — the session-key lifetime seam. Asserts both arms work:
//   ephemeral — caches per process; clear() drops it; re-deriving is deterministic
//               (same wallet → same key), so no data is lost by not persisting.
//   persisted — derives + saves once (one signature); a later instance reads the
//               vault and skips the signature entirely (the "local storage mode" win).
// No CLI/network — pure crypto + a fake in-memory vault. Run: tsx test/test-keypolicy.ts
import { Keypair } from "@solana/web3.js";
import { keypairWallet } from "../src/account/keypairWallet.js";
import { ephemeralKey, persistedKey, type KeyVault } from "../src/account/keyPolicy.js";
import { deriveSessionKey, type SessionKey } from "../src/core/crypto.js";

const wallet = keypairWallet(Keypair.generate());

// ── ephemeral: cache, then clear → re-derive to the SAME deterministic key ──
const eph = ephemeralKey();
const k1 = await eph.getKey(wallet);
const k2 = await eph.getKey(wallet);
eph.clear();
const k3 = await eph.getKey(wallet);
const ephOk = k1 === k2 /* cached */ && k1 !== k3 /* fresh object */ && k1.pubHex === k3.pubHex /* same key */;

// ── persisted: derive+save once; a second instance reads the vault, no signature ──
let signCount = 0;
const counting = { ...wallet, signMessage: async (m: Uint8Array) => { signCount++; return wallet.signMessage(m); } };
const store = new Map<string, SessionKey>();
const vault: KeyVault = {
  read: async (a) => store.get(a) ?? null,
  write: async (a, key) => { store.set(a, key); },
  remove: async (a) => { store.delete(a); },
};
const pk1 = await persistedKey(vault).getKey(counting); // derive + save (1 signature)
const pk2 = await persistedKey(vault).getKey(counting); // fresh instance → read vault (0 more)
const perOk = signCount === 1 && pk1.pubHex === pk2.pubHex;

// ── consistency: policy key == direct derive ──
const direct = await deriveSessionKey(wallet);
const sameOk = direct.pubHex === k1.pubHex;

const ok = ephOk && perOk && sameOk;
console.log(`  ephemeral cache+redrive: ${ephOk ? "✅" : "❌"}  persisted vault reuse (sigs=${signCount}): ${perOk ? "✅" : "❌"}  policy==direct: ${sameOk ? "✅" : "❌"}`);
console.log(ok ? "✅ PASS — key lifetime policy: ephemeral + persisted both work" : "❌ FAIL");
process.exit(ok ? 0 : 1);
