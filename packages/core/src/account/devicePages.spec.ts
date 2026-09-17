import { expect, it, vi } from "vitest";
import { SessionStore, PAGE_SIZE } from "./store.js";
import { mirrorStorage } from "./storage/mirror.js";
import { testWallet } from "./keypairWallet.js";
import { parseSessionPage } from "./devicePages.js";
import type { StorageAdapter } from "../runtime/contract.js";
vi.mock("../core/device.js", () => ({
  getDeviceProfile: async () => ({ id: "same-device", label: "Test" }),
}));
function memory(): StorageAdapter {
  const blobs = new Map<string, Uint8Array>();
  return {
    get: async (k) => blobs.get(k)?.slice() ?? null,
    put: async (k, v) => {
      blobs.set(k, v.slice());
    },
    remove: async (k) => {
      blobs.delete(k);
    },
    list: async () => [...blobs.keys()],
  };
}
// put-only adapter exercises read/modify/write serialization inside a writer.
function cloudMode(): StorageAdapter {
  return { ...memory(), cloudState: () => "ok" };
}
const meta = {
  sessionId: "shared",
  title: "Conversation",
  cli: "claude" as const,
  ts: 1,
};
const msg = (text: string, ts = 1) => ({ role: "user" as const, text, ts });
it("separates concurrent writers on the same device and serializes concurrent appends", async () => {
  const storage = cloudMode(),
    wallet = testWallet(221),
    a = new SessionStore(wallet, storage),
    b = new SessionStore(wallet, storage);
  await Promise.all(
    Array.from({ length: 35 }, (_, i) =>
      Promise.all([
        a.appendMessage(meta, msg(`A${i}`)),
        b.appendMessage(meta, msg(`B${i}`)),
      ]),
    ),
  );
  const fresh = new SessionStore(wallet, storage),
    all = (await fresh.load("shared"))!;
  expect(all.messages).toHaveLength(70);
  expect(new Set(all.messages.map((m) => m.text)).size).toBe(70);
  expect(
    new Set((await storage.list()).map((k) => parseSessionPage(k)?.writer))
      .size,
  ).toBe(2);
  expect(await fresh.listMine()).toHaveLength(1);
});
it("keeps pagination stable when new messages and a new chain arrive", async () => {
  const storage = cloudMode(),
    wallet = testWallet(222),
    a = new SessionStore(wallet, storage),
    b = new SessionStore(wallet, storage);
  for (let i = 0; i < 45; i++)
    await (i % 2 ? a : b).appendMessage(meta, msg(`old${i}`));
  const reader = new SessionStore(wallet, storage),
    page = await reader.loadLatest("shared");
  expect(page.messages).toHaveLength(PAGE_SIZE);
  expect(typeof page.cursor).toBe("string");
  await a.appendMessage(meta, msg("new tail"));
  await new SessionStore(wallet, storage).appendMessage(meta, msg("new chain"));
  const older = await reader.loadOlder("shared", page.cursor!);
  expect([...older.messages, ...page.messages].map((m) => m.text)).toEqual(
    Array.from({ length: 45 }, (_, i) => `old${i}`),
  );
  expect(older.hasMore).toBe(false);
  await expect(reader.loadOlder("other", page.cursor!)).rejects.toThrow(
    "Invalid history cursor",
  );
});
it("merges legacy pages without rewriting them and orders skewed new writes after observed history", async () => {
  const storage = memory(),
    wallet = testWallet(223),
    legacy = new SessionStore(wallet, storage);
  const future = Date.now() + 1_000_000;
  await legacy.appendMessage(meta, msg("legacy", future));
  const before = await storage.get("shared__p0");
  const modern = new SessionStore(wallet, {
    ...storage,
    cloudState: () => "ok",
  });
  await modern.appendMessage(meta, msg("new despite slow clock", 1));
  expect((await modern.load("shared"))!.messages.map((m) => m.text)).toEqual([
    "legacy",
    "new despite slow clock",
  ]);
  expect(await storage.get("shared__p0")).toEqual(before);
});
it("refreshes other writers and metadata without discarding local first paint", async () => {
  const cloud = memory(),
    local = memory(),
    wallet = testWallet(224),
    a = new SessionStore(wallet, mirrorStorage(local, cloud));
  // cloudMode is immediate to avoid waiting for the mirror debounce in this reader test.
  const b = new SessionStore(wallet, { ...cloud, cloudState: () => "ok" });
  await b.appendMessage(meta, msg("first"));
  expect((await a.load("shared"))!.messages).toHaveLength(1);
  await b.appendMessage(
    { ...meta, title: "Updated", model: "new-model" },
    msg("second"),
  );
  expect((await a.load("shared"))!.messages).toHaveLength(2);
  expect((await a.listMine())[0].model).toBe("new-model");
  expect((await a.loadLatestLocal("shared")).messages).toEqual([]);
});
it("reconnect repairs an existing cloud page with an offline tail", async () => {
  const cloud = memory(),
    local = memory(),
    wallet = testWallet(225),
    mirror = mirrorStorage(local, cloud);
  const a = new SessionStore(wallet, mirror);
  await a.appendMessage(meta, msg("online"));
  await mirror.backfill!();
  const old = await cloud.get((await cloud.list())[0]);
  await a.appendMessage(meta, msg("offline tail"));
  expect(await cloud.get((await cloud.list())[0])).toEqual(old);
  await mirror.backfill!();
  expect(
    (await new SessionStore(wallet, cloud).load("shared"))!.messages.map(
      (m) => m.text,
    ),
  ).toEqual(["online", "offline tail"]);
});
it("forks and removes all chains without writing to source pages", async () => {
  const storage = cloudMode(),
    wallet = testWallet(226),
    a = new SessionStore(wallet, storage),
    b = new SessionStore(wallet, storage);
  await a.appendMessage(meta, msg("a"));
  await b.appendMessage(meta, msg("b"));
  expect(await a.fork("shared", "copy", "Copy")).toEqual({ messages: 2 });
  expect((await a.load("copy"))!.messages.map((m) => m.text)).toEqual([
    "a",
    "b",
  ]);
  await a.remove("shared");
  expect(await a.load("shared")).toBeNull();
  expect((await a.load("copy"))!.messages).toHaveLength(2);
});
it("does not silently return partial history when a chain page is missing", async () => {
  const storage = cloudMode(),
    wallet = testWallet(227),
    a = new SessionStore(wallet, storage);
  for (let i = 0; i < 31; i++) await a.appendMessage(meta, msg(`${i}`));
  const first = (await storage.list()).find(
    (k) => parseSessionPage(k)?.page === 0,
  )!;
  await storage.remove(first);
  await expect(a.load("shared")).rejects.toThrow("Session page unavailable");
});
it("backfill never replaces a longer cloud page with a restored stale local backup", async () => {
  const cloud = memory(),
    local = memory(),
    wallet = testWallet(228),
    mirror = mirrorStorage(local, cloud);
  const writer = new SessionStore(wallet, mirror);
  await writer.appendMessage(meta, msg("first"));
  await mirror.backfill!();
  const name = (await local.list())[0],
    old = (await local.get(name))!;
  await writer.appendMessage(meta, msg("second"));
  await mirror.backfill!();
  const complete = await cloud.get(name);
  // A new mirror has no delayed flush from the old writer, matching restart/restore.
  const restored = memory();
  await restored.put(name, old);
  await mirrorStorage(restored, cloud).backfill!();
  expect(await cloud.get(name)).toEqual(complete);
});
it("keeps exact message timestamps in an explicit fork", async () => {
  const storage = cloudMode(),
    wallet = testWallet(229),
    writer = new SessionStore(wallet, storage);
  await writer.appendMessage(meta, msg("first"));
  await writer.appendMessage(meta, msg("second"));
  const source = (await writer.load("shared"))!;
  await writer.fork("shared", "copy", "Copy");
  expect((await writer.load("copy"))!.messages).toEqual(source.messages);
});
it("new writer keys cannot be mistaken for writable legacy session pages", async () => {
  const storage = cloudMode(),
    writer = new SessionStore(testWallet(230), storage);
  await writer.appendMessage(meta, msg("modern"));
  for (const key of await storage.list()) {
    // The old reader splits at lastIndexOf('__p'); it must ignore this namespace.
    expect(key.lastIndexOf("__p")).toBe(-1);
    expect(parseSessionPage(key)?.sessionId).toBe("shared");
  }
});
it("does not overlap normal cloud flushes for a writer page", async () => {
  vi.useFakeTimers();
  try {
    const cloud = memory(),
      local = memory(),
      put = cloud.put;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    cloud.put = async (k, v) => {
      calls++;
      if (calls === 1) await gate;
      await put(k, v);
    };
    const writer = new SessionStore(
      testWallet(231),
      mirrorStorage(local, cloud),
    );
    await writer.appendMessage(meta, msg("first"));
    await vi.advanceTimersByTimeAsync(2500);
    await writer.appendMessage(meta, msg("second"));
    await vi.advanceTimersByTimeAsync(2500);
    expect(calls).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
    expect(
      (await new SessionStore(testWallet(231), cloud).load(
        "shared",
      ))!.messages.map((m) => m.text),
    ).toEqual(["first", "second"]);
  } finally {
    vi.useRealTimers();
  }
});
it("rollover leaves the full page byte-for-byte unchanged", async () => {
  const storage = cloudMode(),
    writer = new SessionStore(testWallet(232), storage);
  for (let i = 0; i < PAGE_SIZE; i++)
    await writer.appendMessage(meta, msg(`${i}`));
  const first = (await storage.list())[0],
    before = await storage.get(first);
  await writer.appendMessage(meta, msg("rollover"));
  expect(await storage.get(first)).toEqual(before);
  expect(await storage.list()).toHaveLength(2);
});
