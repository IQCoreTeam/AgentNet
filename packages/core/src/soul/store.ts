// Encrypted soul persistence (plans/soul-memory-portability.md §3C). The soul is the
// agent's persona — a free-form SOUL.md markdown master — and unlike memory it is
// PER-WALLET GLOBAL, not per-project: the agent is the same self in every project, so
// there is exactly one blob per wallet ("soul", no project suffix in the key).
//
// Same vault mechanics as MemoryStore: wallet-derived key, user-owned StorageAdapter,
// one small blob rewritten in place. The one soul-specific addition is the lastWriter
// header (pillar 3 of issue #84): the soul is a single document, so cross-device merge
// is last-writer-wins, and lastWriter makes that visible/attributable instead of silent.

import type { StorageAdapter, Wallet } from "../runtime/contract.js";
import {
  deriveSessionKey,
  encryptForWallet,
  decryptForWallet,
  type SessionKey,
} from "../core/crypto.js";
import { getDeviceProfile } from "../core/device.js";

export const SOUL_KEY = "soul";

/** Size cap for the SOUL.md text — a persona is prose, not a data dump, and soul_set
 *  is reachable by any full-mode host, so an unbounded write is the one obvious abuse.
 *  32k chars is roomy for the recognized sections + plenty of free-form lore. */
export const SOUL_TEXT_MAX = 32_000;

export interface SoulDoc {
  version: 1;
  /** The SOUL.md markdown master (recognized sections + free-form, see plan §3C). */
  text: string;
  /** Who wrote this revision — device id + human label + wall-clock ms. */
  lastWriter: { device: string; label: string; ts: number };
}

export class SoulStore {
  private key?: SessionKey;

  constructor(
    private wallet: Wallet,
    private storage: StorageAdapter,
  ) {}

  private async getKey(): Promise<SessionKey> {
    return (this.key ??= await deriveSessionKey(this.wallet));
  }

  /** Load + decrypt the wallet's soul. null = no soul written yet (a valid state —
   *  the agent simply has no persona doc, not an error). */
  async load(): Promise<SoulDoc | null> {
    const blob = await this.storage.get(SOUL_KEY);
    if (!blob) return null;
    const plain = await decryptForWallet(await this.getKey(), blob);
    return JSON.parse(new TextDecoder().decode(plain)) as SoulDoc;
  }

  /** Encrypt + write the soul, stamping THIS device as lastWriter. Whole-doc replace
   *  (last-writer-wins by design); returns the stored doc so callers can echo the stamp. */
  async save(text: string): Promise<SoulDoc> {
    if (text.length > SOUL_TEXT_MAX) {
      throw new Error(`Soul text too long (${text.length}/${SOUL_TEXT_MAX} characters).`);
    }
    const { id, label } = await getDeviceProfile();
    const doc: SoulDoc = { version: 1, text, lastWriter: { device: id, label, ts: Date.now() } };
    const plain = new TextEncoder().encode(JSON.stringify(doc));
    await this.storage.put(SOUL_KEY, await encryptForWallet(await this.getKey(), plain));
    return doc;
  }
}
