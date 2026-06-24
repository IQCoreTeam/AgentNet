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
import { type SessionKey } from "../core/crypto.js";
import { ephemeralKey, type KeyPolicy } from "./keyPolicy.js";
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

// Highest page index for `sessionId` among `keys` (-1 if none).
function maxPageOf(keys: string[], sessionId: string): number {
  let max = -1;
  for (const key of keys) {
    const p = parsePageKey(key);
    if (p && p.sessionId === sessionId && p.page > max) max = p.page;
  }
  return max;
}

export interface PageResult {
  messages: ChatMessage[];
  hasMore: boolean; // older pages exist
  cursor: number | null; // page index to pass to loadOlder for the previous page
}

export class SessionStore {
  // per-session in-memory state for the CURRENT page (this process)
  private cur = new Map<string, { page: number; count: number }>();

  // The key POLICY owns the session key's lifetime (memory vs persisted). Defaults to
  // ephemeral so existing callers are unchanged; a surface passes persistedKey(vault)
  // to enable "local storage mode".
  constructor(
    private wallet: Wallet,
    private storage: StorageAdapter,
    private keys: KeyPolicy = ephemeralKey(),
  ) {}

  private getKey(): Promise<SessionKey> {
    return this.keys.getKey(this.wallet);
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
  // Prefer the LOCAL tier: writes always hit local first, so any session used on this
  // device is fully present locally and we can find its newest page without a network
  // round-trip (the mirror's cloud list is a Drive API call, paid on EVERY open before
  // this). Only when local has nothing for the session do we fall back to the full list
  // — e.g. first open of a session synced from another device.
  private lastTier: "local" | "cloud" = "local"; // which tier answered the last lastPageIndex (perf diag)
  private async lastPageIndex(sessionId: string): Promise<number> {
    if (this.storage.listLocal) {
      const local = maxPageOf(await this.storage.listLocal(), sessionId);
      if (local >= 0) { this.lastTier = "local"; return local; }
    }
    this.lastTier = "cloud";
    return maxPageOf(await this.storage.list(), sessionId);
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

  async recordMeta(meta: Omit<CanonicalSession, "messages">): Promise<void> {
    const key = await this.getKey();
    const state = await this.currentPage(meta.sessionId);
    const pk = pageKey(meta.sessionId, state.page);
    await this.write(pk, await encodeRecord(key, metaRecord(meta)));
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
    const t0 = Date.now();
    let idx = await this.lastPageIndex(sessionId);
    const t1 = Date.now();
    if (idx < 0) return { messages: [], hasMore: false, cursor: null };
    // Inline get + decode (instead of loadPage) so we can time each leg separately:
    // get = storage read (local fs vs Drive download), decode = decrypt+parse the blob.
    let blob = await this.storage.get(pageKey(sessionId, idx));
    const t2 = Date.now();
    let decoded = blob ? await decodeLog(await this.getKey(), blob) : null;
    // Walk back over EMPTY trailing pages. appendMessage writes a new page's meta line
    // BEFORE its first message on rollover, so a page can exist with just meta (decodes to
    // zero messages) when a session rolled over but no message landed there yet, or a write
    // was interrupted. Returning that verbatim painted a BLANK chat that only filled on a
    // manual scroll-up or reopen — the "this chat won't load" bug. Land on the newest page
    // that actually has messages.
    while ((decoded?.messages.length ?? 0) === 0 && idx > 0) {
      idx -= 1;
      blob = await this.storage.get(pageKey(sessionId, idx));
      decoded = blob ? await decodeLog(await this.getKey(), blob) : null;
    }
    const t3 = Date.now();
    console.error(
      `[perf] loadLatest ${sessionId.slice(0, 8)} page=${idx} discover=${t1 - t0}ms(${this.lastTier}) ` +
      `get=${t2 - t1}ms(${blob?.length ?? 0}B) decode=${t3 - t2}ms msgs=${decoded?.messages.length ?? 0}`,
    );
    return { messages: decoded?.messages ?? [], hasMore: idx > 0, cursor: idx > 0 ? idx - 1 : null };
  }

  // The page at `cursor` (older). Returns its messages + cursor to the one before.
  async loadOlder(sessionId: string, cursor: number): Promise<PageResult> {
    if (cursor < 0) return { messages: [], hasMore: false, cursor: null };
    // Inline get + decode (instead of loadPage) so the "loading older..." scroll-up cost is
    // timed per leg, exactly like loadLatest; each older page is its own Drive round-trip.
    const t0 = Date.now();
    const blob = await this.storage.get(pageKey(sessionId, cursor));
    const t1 = Date.now();
    const s = blob ? await decodeLog(await this.getKey(), blob) : null;
    const t2 = Date.now();
    console.error(
      `[perf] loadOlder ${sessionId.slice(0, 8)} page=${cursor} ` +
      `get=${t1 - t0}ms(${blob?.length ?? 0}B) decode=${t2 - t1}ms msgs=${s?.messages.length ?? 0}`,
    );
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
    const t0 = Date.now();
    const latestPage = new Map<string, number>();
    for (const key of await this.storage.list()) {
      const p = parsePageKey(key);
      if (!p) continue;
      const prev = latestPage.get(p.sessionId);
      if (prev === undefined || p.page > prev) latestPage.set(p.sessionId, p.page);
    }
    const tList = Date.now();
    // Read every session's newest page IN PARALLEL. On a cloud tier (Drive) each loadPage
    // is a network round-trip (download + decrypt); doing them serially made the chat-list
    // sync at app start cost 1 + N sequential round-trips (visibly slow on mobile/Drive).
    // Promise.all overlaps them so the wall-clock is ~the slowest single page, not the sum.
    const metas = await Promise.all(
      [...latestPage].map(async ([sessionId, page]) => {
        // A page encrypted with a DIFFERENT wallet key (e.g. after reconnecting a new
        // keypair) can't be decrypted; skip it instead of failing the whole list, so one
        // unreadable session never hides all the readable ones.
        try {
          const s = await this.loadPage(sessionId, page);
          return s ? { sessionId, title: s.title, cli: s.cli, ts: s.ts, lastDevice: s.lastDevice } : null;
        } catch {
          return null; // undecryptable (foreign key / corrupt), omit from the list
        }
      }),
    );
    const out = metas.filter((m): m is SessionMeta => m !== null).sort((a, b) => b.ts - a.ts);
    console.error(
      `[perf] listMine sessions=${latestPage.size} kept=${out.length} ` +
      `list=${tList - t0}ms pages=${Date.now() - tList}ms total=${Date.now() - t0}ms`,
    );
    return out;
  }
}
