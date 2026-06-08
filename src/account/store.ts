// Session persistence over an append-only encrypted log (see sessionLog.ts).
// - appendMessage(): adds ONE encrypted line (fast, no rewrite). Uses the
//   adapter's append if present, else get+put (still additive — the blob is a log).
// - load(): reads the whole log and replays it into a CanonicalSession.
// One log per sessionId → claude and codex sharing a sessionId share the log.

import type {
  CanonicalSession,
  ChatMessage,
  SessionMeta,
  StorageAdapter,
  Wallet,
} from "../runtime/contract.js";
import { deriveSessionKey, type SessionKey } from "../core/crypto.js";
import { encodeRecord, metaRecord, msgRecord, decodeLog } from "./sessionLog.js";

export class SessionStore {
  private key?: SessionKey;
  private started = new Set<string>(); // sessionIds whose meta line is written

  constructor(
    private wallet: Wallet,
    private storage: StorageAdapter,
  ) {}

  private async getKey(): Promise<SessionKey> {
    if (!this.key) this.key = await deriveSessionKey(this.wallet);
    return this.key;
  }

  private async write(sessionId: string, chunk: Uint8Array): Promise<void> {
    if (this.storage.append) {
      await this.storage.append(sessionId, chunk);
    } else {
      const prev = (await this.storage.get(sessionId)) ?? new Uint8Array();
      const merged = new Uint8Array(prev.length + chunk.length);
      merged.set(prev, 0);
      merged.set(chunk, prev.length);
      await this.storage.put(sessionId, merged);
    }
  }

  // Append one message. On first call for a session, also writes the meta line.
  async appendMessage(
    meta: Omit<CanonicalSession, "messages">,
    msg: ChatMessage,
  ): Promise<void> {
    const key = await this.getKey();
    if (!this.started.has(meta.sessionId)) {
      // if a log already exists (resumed session), don't re-write meta
      const existing = await this.storage.get(meta.sessionId);
      if (!existing || existing.length === 0) {
        await this.write(meta.sessionId, await encodeRecord(key, metaRecord(meta)));
      }
      this.started.add(meta.sessionId);
    }
    await this.write(meta.sessionId, await encodeRecord(key, msgRecord(msg)));
  }

  async remove(sessionId: string): Promise<void> {
    this.started.delete(sessionId);
    await this.storage.remove(sessionId);
  }

  async load(sessionId: string): Promise<CanonicalSession | null> {
    const blob = await this.storage.get(sessionId);
    if (!blob) return null;
    return decodeLog(await this.getKey(), blob);
  }

  async listMine(): Promise<SessionMeta[]> {
    const ids = await this.storage.list();
    const metas: SessionMeta[] = [];
    for (const id of ids) {
      const s = await this.load(id);
      if (s) metas.push({ sessionId: s.sessionId, title: s.title, cli: s.cli, ts: s.ts });
    }
    return metas.sort((a, b) => b.ts - a.ts);
  }
}
