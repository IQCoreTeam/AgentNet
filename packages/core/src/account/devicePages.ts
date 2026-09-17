// Device-scoped single-writer chains. A writer incarnation also separates concurrent
// processes on one device; restarting never takes ownership of an old mutable page.
import { randomUUID } from "node:crypto";
import type {
  CanonicalSession,
  ChatMessage,
  StorageAdapter,
  PageResult,
} from "../runtime/contract.js";
import type { SessionKey } from "../core/crypto.js";
import { getDeviceProfile } from "../core/device.js";
import {
  decodeLog,
  encodeRecord,
  metaRecord,
  msgRecord,
} from "./sessionLog.js";

export function parseSessionPage(
  key: string,
): { sessionId: string; writer: string; page: number } | null {
  const match = /^(.*?)__(?:d([a-zA-Z0-9-]+)__dp|p)(\d+)$/.exec(key);
  if (!match || !match[1]) return null;
  const page = Number(match[3]);
  return Number.isSafeInteger(page)
    ? { sessionId: match[1], writer: match[2] ?? "", page }
    : null;
}
function pageKey(sessionId: string, writer: string, page: number): string {
  return writer
    ? `${sessionId}__d${writer}__dp${page}`
    : `${sessionId}__p${page}`;
}
type Position = { writer: string; page: number; index: number | null };
type Cursor = { sessionId: string; positions: Position[] };
const PREFIX = "device-pages:1:";
function parseCursor(value: string, sessionId: string): Position[] {
  if (!value.startsWith(PREFIX) || value.length > 100_000)
    throw new Error("Invalid history cursor; reopen the session.");
  const parsed: Cursor = JSON.parse(value.slice(PREFIX.length));
  if (
    parsed.sessionId !== sessionId ||
    !Array.isArray(parsed.positions) ||
    parsed.positions.length > 1000 ||
    parsed.positions.some(
      (p) =>
        typeof p.writer !== "string" ||
        !/^[a-zA-Z0-9-]*$/.test(p.writer) ||
        !Number.isSafeInteger(p.page) ||
        p.page < -1 ||
        (p.index !== null && (!Number.isSafeInteger(p.index) || p.index < -1)),
    )
  ) {
    throw new Error("Invalid history cursor; reopen the session.");
  }
  return parsed.positions;
}

export class DevicePages {
  private readonly incarnation = randomUUID();
  private writer: Promise<string> | undefined;
  private tails = new Map<string, Promise<void>>();
  private current = new Map<
    string,
    { page: number; count: number; clock: number }
  >();
  private observed = new Map<string, number>();
  constructor(
    private storage: StorageAdapter,
    private key: () => Promise<SessionKey>,
    private size: number,
  ) {}

  private writerId(): Promise<string> {
    return (this.writer ??= getDeviceProfile().then(
      (d) => `${d.id}-${this.incarnation}`,
    ));
  }
  // Calls within the same writer must not race a read/append or a page rollover.
  async append(
    meta: Omit<CanonicalSession, "messages">,
    message?: ChatMessage,
  ): Promise<void> {
    const id = meta.sessionId;
    const previous = this.tails.get(id) ?? Promise.resolve();
    const work = previous
      .catch(() => {})
      .then(async () => {
        const writer = await this.writerId();
        let state = this.current.get(id);
        if (!state) {
          // One read on first write seeds the clock from history already observed.
          const heads = await this.heads(id);
          for (const h of heads)
            this.observe(
              id,
              Math.max(h.data.ts, ...h.data.messages.map((m) => m.ts ?? 0)),
            );
          state = { page: 0, count: 0, clock: this.observed.get(id) ?? 0 };
          this.current.set(id, state);
        }
        if (state.count >= this.size) {
          state.page++;
          state.count = 0;
        }
        const ts = Math.max(
          Date.now(),
          message?.ts ?? meta.ts,
          state.clock + 1,
          (this.observed.get(id) ?? 0) + 1,
        );
        const key = await this.key();
        const records = [await encodeRecord(key, metaRecord({ ...meta, ts }))];
        if (message)
          records.push(await encodeRecord(key, msgRecord({ ...message, ts })));
        const chunk = new Uint8Array(records.reduce((n, r) => n + r.length, 0));
        let offset = 0;
        for (const r of records) {
          chunk.set(r, offset);
          offset += r.length;
        }
        const name = pageKey(id, writer, state.page);
        if (this.storage.append) await this.storage.append(name, chunk);
        else {
          const prev = (await this.storage.get(name)) ?? new Uint8Array();
          const next = new Uint8Array(prev.length + chunk.length);
          next.set(prev);
          next.set(chunk, prev.length);
          await this.storage.put(name, next);
        }
        state.clock = ts;
        if (message) state.count++;
        this.observe(id, ts);
      });
    this.tails.set(id, work);
    try {
      await work;
    } finally {
      if (this.tails.get(id) === work) this.tails.delete(id);
    }
  }
  async copy(
    meta: Omit<CanonicalSession, "messages">,
    messages: ChatMessage[],
  ): Promise<void> {
    const writer = await this.writerId(),
      key = await this.key();
    for (let i = 0; i < Math.max(1, messages.length); i += this.size) {
      const records = [await encodeRecord(key, metaRecord(meta))];
      for (const message of messages.slice(i, i + this.size))
        records.push(await encodeRecord(key, msgRecord(message)));
      const bytes = new Uint8Array(records.reduce((n, r) => n + r.length, 0));
      let offset = 0;
      for (const r of records) {
        bytes.set(r, offset);
        offset += r.length;
      }
      await this.storage.put(
        pageKey(meta.sessionId, writer, Math.floor(i / this.size)),
        bytes,
      );
    }
    const last = messages.at(-1)?.ts ?? meta.ts;
    this.current.set(meta.sessionId, {
      page: Math.floor(Math.max(0, messages.length - 1) / this.size),
      count: messages.length ? ((messages.length - 1) % this.size) + 1 : 0,
      clock: Math.max(last, meta.ts),
    });
  }
  private observe(id: string, ts: number): void {
    this.observed.set(id, Math.max(this.observed.get(id) ?? 0, ts));
  }
  private async positions(id: string, local: boolean): Promise<Position[]> {
    const keys = await (local && this.storage.listLocal
      ? this.storage.listLocal()
      : this.storage.list());
    const latest = new Map<string, number>();
    for (const k of keys) {
      const p = parseSessionPage(k);
      if (p?.sessionId === id)
        latest.set(p.writer, Math.max(latest.get(p.writer) ?? -1, p.page));
    }
    return [...latest].map(([writer, page]) => ({ writer, page, index: null }));
  }
  private async read(
    id: string,
    p: Position,
    local = false,
  ): Promise<CanonicalSession> {
    const name = pageKey(id, p.writer, p.page);
    const blob = await (local && this.storage.getLocal
      ? this.storage.getLocal(name)
      : this.storage.get(name));
    const data = blob && (await decodeLog(await this.key(), blob));
    if (!data || data.sessionId !== id)
      throw new Error(`Session page unavailable: ${name}`);
    this.observe(id, Math.max(data.ts, ...data.messages.map((m) => m.ts ?? 0)));
    return data;
  }
  private async heads(id: string, local = false) {
    const positions = await this.positions(id, local);
    return Promise.all(
      positions.map(async (p) => ({
        writer: p.writer,
        data: await this.read(id, p, local),
      })),
    );
  }
  async meta(id: string): Promise<Omit<CanonicalSession, "messages"> | null> {
    const heads = await this.heads(id);
    heads.sort(
      (a, b) => a.data.ts - b.data.ts || compareText(a.writer, b.writer),
    );
    const winner = heads.at(-1)?.data;
    if (!winner) return null;
    const { messages: _, ...meta } = winner;
    return {
      ...meta,
      ts: Math.max(
        ...heads.map((h) =>
          Math.max(h.data.ts, ...h.data.messages.map((m) => m.ts ?? 0)),
        ),
      ),
    };
  }
  // Cursor records each chain's next unread position. New appends/new chains cannot
  // shift an older page or duplicate messages during an existing scroll traversal.
  async page(id: string, cursor?: string, local = false): Promise<PageResult> {
    const positions = cursor
      ? parseCursor(cursor, id)
      : await this.positions(id, local);
    const cache = new Map<string, CanonicalSession>();
    const peek = async (p: Position): Promise<ChatMessage | undefined> => {
      while (p.page >= 0) {
        const name = pageKey(id, p.writer, p.page);
        let data = cache.get(name);
        if (!data) {
          data = await this.read(id, p, local);
          cache.set(name, data);
        }
        if (p.index === null) p.index = data.messages.length - 1;
        if (p.index >= data.messages.length)
          throw new Error("History changed while paging; reopen the session.");
        if (p.index >= 0) return data.messages[p.index];
        p.page--;
        p.index = null;
      }
      return undefined;
    };
    const result: ChatMessage[] = [];
    while (result.length < this.size) {
      const next = await Promise.all(positions.map(peek));
      let best = -1;
      for (let i = 0; i < next.length; i++) {
        if (!next[i]) continue;
        if (
          best < 0 ||
          (next[i]!.ts ?? 0) > (next[best]!.ts ?? 0) ||
          ((next[i]!.ts ?? 0) === (next[best]!.ts ?? 0) &&
            compareText(positions[i]!.writer, positions[best]!.writer) > 0)
        )
          best = i;
      }
      if (best < 0) break;
      result.push(next[best]!);
      positions[best]!.index = positions[best]!.index! - 1;
    }
    const remaining = await Promise.all(positions.map(peek));
    const hasMore = remaining.some(Boolean);
    return {
      messages: result.reverse(),
      hasMore,
      cursor: hasMore
        ? PREFIX + JSON.stringify({ sessionId: id, positions })
        : null,
    };
  }
  async load(id: string): Promise<CanonicalSession | null> {
    const meta = await this.meta(id);
    if (!meta) return null;
    const pages: ChatMessage[][] = [];
    let p = await this.page(id);
    pages.push(p.messages);
    while (p.hasMore && typeof p.cursor === "string") {
      p = await this.page(id, p.cursor);
      pages.push(p.messages);
    }
    return { ...meta, messages: pages.reverse().flat() };
  }
}
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
