// Encrypted canonical-memory persistence (issue #18). One small blob per (wallet,
// project) on the StorageAdapter — the SAME user-owned storage (Google Drive etc.)
// and the SAME wallet crypto as session blobs, so only the wallet decrypts it and it
// syncs across devices. Unlike sessions this isn't an append-only log (memory is
// small and rewritten in place), so there's no paging — just get/put one blob.
//
// The adapter is already scoped per wallet (buildStorage(cfg, walletAddress)); we add
// a per-project key so each project's memory is separate (matches Claude's per-cwd
// memory dir). See plans/shared-memory.md.

import type { StorageAdapter, Wallet } from "../runtime/contract.js";
import {
  deriveSessionKey,
  encryptForWallet,
  decryptForWallet,
  type SessionKey,
} from "../core/crypto.js";
import type { CanonicalMemory } from "./types.js";
import { emptyMemory } from "./types.js";

// Storage key for a project's memory blob. cwd "/" -> "-" so it's a flat key, the
// same encoding Claude uses for its per-project dir.
export function memoryKey(cwd: string): string {
  return `memory__${cwd.replaceAll("/", "-")}`;
}

export class MemoryStore {
  private key?: SessionKey;

  constructor(
    private wallet: Wallet,
    private storage: StorageAdapter,
  ) {}

  private async getKey(): Promise<SessionKey> {
    return (this.key ??= await deriveSessionKey(this.wallet));
  }

  // Load + decrypt a project's canonical memory (empty if none stored yet).
  async load(cwd: string): Promise<CanonicalMemory> {
    const blob = await this.storage.get(memoryKey(cwd));
    if (!blob) return emptyMemory();
    const plain = await decryptForWallet(await this.getKey(), blob);
    return JSON.parse(new TextDecoder().decode(plain)) as CanonicalMemory;
  }

  // Encrypt + write a project's canonical memory (overwrites the single blob).
  async save(cwd: string, mem: CanonicalMemory): Promise<void> {
    const plain = new TextEncoder().encode(JSON.stringify(mem));
    const blob = await encryptForWallet(await this.getKey(), plain);
    await this.storage.put(memoryKey(cwd), blob);
  }
}
