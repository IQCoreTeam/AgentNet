// Paginated session persistence over encrypted page logs (see sessionLog.ts).
// A session is stored as PAGES: keys "{sessionId}__p{N}", PAGE_SIZE messages each.
// Only the current (last) page is appended to; full pages are never rewritten —
// so long sessions stay fast and cloud re-uploads are bounded to one page.
//
// - appendMessage(): append to the current page; roll to a new page at PAGE_SIZE.
// - loadLatest(): newest page's messages + whether older pages exist (cursor).
// - loadOlder(): the page before a given index (scroll-to-load-older).
// - listMine(): one entry per session, meta read from its newest page only.

import type {
  CanonicalSession,
  ChatMessage,
  SessionMeta,
  StorageAdapter,
  Wallet,
} from "../runtime/contract.js";
import { deriveSessionKey, type SessionKey } from "../core/crypto.js";
import { encodeRecord, metaRecord, msgRecord, decodeLog } from "./sessionLog.js";

export const PAGE_SIZE = 30;

const pageKey = (sessionId: string, page: number) => `${sessionId}__p${page}`;
// parse "abc__p2" -> { sessionId: "abc", page: 2 }; null if not a page key
function parsePageKey(key: string): { sessionId: string; page: number } | null {
  const i = key.lastIndexOf("__p");
  if (i < 0) return null;
  const page = Number(key.slice(i + 3));
  if (!Number.isInteger(page)) return null;
  return { sessionId: key.slice(0, i), page };
}

export interface PageResult {
  messages: ChatMessage[];
  hasMore: boolean; // older pages exist
  cursor: number | null; // page index to pass to loadOlder for the previous page
}

export class SessionStore {
  private key?: SessionKey;
  // per-session in-memory state for the CURRENT page (this process)
  private cur = new Map<string, { page: number; count: number }>();

  constructor(
    private wallet: Wallet,
    private storage: StorageAdapter,
  ) {}

  private async getKey(): Promise<SessionKey> {
    if (!this.key) this.key = await deriveSessionKey(this.wallet);
    return this.key;
  }

  private async write(key: string, chunk: Uint8Array): Promise<void> {
    if (this.storage.append) {
      await this.storage.append(key, chunk);
    } else {
      const prev = (await this.storage.get(key)) ?? new Uint8Array();
      const merged = new Uint8Array(prev.length + chunk.length);
      merged.set(prev, 0);
      merged.set(chunk, prev.length);
      await this.storage.put(key, merged);
    }
  }

  // Find the highest existing page index for a session (-1 if none).
  private async lastPageIndex(sessionId: string): Promise<number> {
    let max = -1;
    for (const key of await this.storage.list()) {
      const p = parsePageKey(key);
      if (p && p.sessionId === sessionId && p.page > max) max = p.page;
    }
    return max;
  }

  // Resolve the current page + how many messages are in it, loading from storage
  // the first time we touch this session in this process.
  private async currentPage(sessionId: string): Promise<{ page: number; count: number }> {
    const cached = this.cur.get(sessionId);
    if (cached) return cached;
    const last = await this.lastPageIndex(sessionId);
    if (last < 0) {
      const fresh = { page: 0, count: 0 };
      this.cur.set(sessionId, fresh);
      return fresh;
    }
    const blob = await this.storage.get(pageKey(sessionId, last));
    const decoded = blob ? await decodeLog(await this.getKey(), blob) : null;
    const state = { page: last, count: decoded?.messages.length ?? 0 };
    this.cur.set(sessionId, state);
    return state;
  }

  // Append one message to the current page; roll to a new page at PAGE_SIZE.
  // Each page carries its own meta line (so it's self-contained for reading).
  async appendMessage(
    meta: Omit<CanonicalSession, "messages">,
    msg: ChatMessage,
  ): Promise<void> {
    const key = await this.getKey();
    const state = await this.currentPage(meta.sessionId);

    if (state.count >= PAGE_SIZE) {
      state.page += 1;
      state.count = 0;
    }
    const pk = pageKey(meta.sessionId, state.page);

    if (state.count === 0) {
      // new (empty) page -> write its meta line first
      await this.write(pk, await encodeRecord(key, metaRecord(meta)));
    }
    await this.write(pk, await encodeRecord(key, msgRecord(msg)));
    state.count += 1;
  }

  async remove(sessionId: string): Promise<void> {
    this.cur.delete(sessionId);
    for (const k of await this.storage.list()) {
      const p = parsePageKey(k);
      if (p && p.sessionId === sessionId) await this.storage.remove(k);
    }
  }

  private async loadPage(sessionId: string, page: number): Promise<CanonicalSession | null> {
    const blob = await this.storage.get(pageKey(sessionId, page));
    if (!blob) return null;
    return decodeLog(await this.getKey(), blob);
  }

  // Newest page + cursor to the page before it.
  async loadLatest(sessionId: string): Promise<PageResult> {
    const last = await this.lastPageIndex(sessionId);
    if (last < 0) return { messages: [], hasMore: false, cursor: null };
    const s = await this.loadPage(sessionId, last);
    return { messages: s?.messages ?? [], hasMore: last > 0, cursor: last > 0 ? last - 1 : null };
  }

  // The page at `cursor` (older). Returns its messages + cursor to the one before.
  async loadOlder(sessionId: string, cursor: number): Promise<PageResult> {
    if (cursor < 0) return { messages: [], hasMore: false, cursor: null };
    const s = await this.loadPage(sessionId, cursor);
    return { messages: s?.messages ?? [], hasMore: cursor > 0, cursor: cursor > 0 ? cursor - 1 : null };
  }

  // Whole session, all pages in order (for non-UI callers / migration).
  async load(sessionId: string): Promise<CanonicalSession | null> {
    const last = await this.lastPageIndex(sessionId);
    if (last < 0) return null;
    let head: CanonicalSession | null = null;
    const messages: ChatMessage[] = [];
    for (let p = 0; p <= last; p++) {
      const s = await this.loadPage(sessionId, p);
      if (!s) continue;
      if (!head) head = s;
      messages.push(...s.messages);
    }
    return head ? { ...head, messages } : null;
  }

  // One entry per session; meta read from the newest page only (cheap).
  async listMine(): Promise<SessionMeta[]> {
    const latestPage = new Map<string, number>();
    for (const key of await this.storage.list()) {
      const p = parsePageKey(key);
      if (!p) continue;
      const prev = latestPage.get(p.sessionId);
      if (prev === undefined || p.page > prev) latestPage.set(p.sessionId, p.page);
    }
    const metas: SessionMeta[] = [];
    for (const [sessionId, page] of latestPage) {
      const s = await this.loadPage(sessionId, page);
      if (s) metas.push({ sessionId, title: s.title, cli: s.cli, ts: s.ts });
    }
    return metas.sort((a, b) => b.ts - a.ts);
  }
}
