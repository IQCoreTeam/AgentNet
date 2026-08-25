import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateSessions } from "./migrate.js";
import { SessionStore, PAGE_SIZE } from "./store.js";
import { manualStorage } from "./storage/manual.js";
import { testWallet } from "./keypairWallet.js";
import type { CanonicalSession, ChatMessage, Wallet } from "../runtime/contract.js";

// Deterministic fixtures: the dedupe compares messages by JSON.stringify, so the
// same builder must produce byte-identical JSON on both sides.
const msg = (i: number): ChatMessage => ({
  role: i % 2 === 0 ? "user" : "assistant",
  text: `message ${i}`,
  ts: 1_700_000_000_000 + i,
});

function meta(
  sessionId: string,
  title: string,
  ts: number,
  lastDevice?: { id: string; label: string },
): Omit<CanonicalSession, "messages"> {
  return { sessionId, cli: "claude", title, ts, ...(lastDevice ? { lastDevice } : {}) };
}

async function seed(
  store: SessionStore,
  m: Omit<CanonicalSession, "messages">,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) await store.appendMessage(m, msg(i));
}

// Snapshot a wallet's session dir: filename -> raw bytes (hex), for byte-identity checks.
function snapshotDir(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(dir)) out[f] = Buffer.from(readFileSync(join(dir, f))).toString("hex");
  return out;
}

describe("account/migrate — session re-key between wallets", () => {
  let home: string;
  const origEnv = { ...process.env };
  const walletA = testWallet(1);
  const walletB = testWallet(2);
  // Fresh store per call: proves reads come from disk, not another instance's caches.
  const storeFor = (w: Wallet) => new SessionStore(w, manualStorage(w.address));
  const dirFor = (w: Wallet) => join(home, "sessions", w.address);

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "agentnet-migrate-"));
    process.env.AGENTNET_HOME = home;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    rmSync(home, { recursive: true, force: true });
  });

  it("re-keys every session: B decrypts and lists what A wrote, across page boundaries", async () => {
    const over = PAGE_SIZE + 5; // forces a page rollover in both source and destination
    const m1 = meta("s1", "long session", 2000, { id: "device-A", label: "Device A" });
    const m2 = meta("s2", "short session", 1000);
    const src = storeFor(walletA);
    await seed(src, m1, over);
    await seed(src, m2, 3);

    const report = await migrateSessions(storeFor(walletA), storeFor(walletB));
    expect(report).toEqual({ copied: 2, skipped: 0, messages: over + 3 });

    // A fresh store under B reads everything back — identity fields and full transcript.
    const dst = storeFor(walletB);
    const listed = await dst.listMine();
    expect(listed.map((s) => s.sessionId)).toEqual(["s1", "s2"]); // last-activity ts, desc
    // listMine reports LAST-ACTIVITY ts (the newest message's ts), not the meta creation
    // ts; the meta ts is preserved on disk and still comes back via load() below.
    expect(listed[0]).toMatchObject({ title: "long session", cli: "claude", ts: msg(over - 1).ts, lastDevice: { id: "device-A", label: "Device A" } });
    expect(listed[1]).toMatchObject({ title: "short session", cli: "claude", ts: msg(2).ts });

    const srcS1 = await storeFor(walletA).load("s1");
    const dstS1 = await dst.load("s1");
    expect(dstS1).toEqual(srcS1);
    expect(dstS1?.messages).toHaveLength(over);
    expect(await dst.load("s2")).toEqual(await storeFor(walletA).load("s2"));

    // The destination really paged: the copy is stored as p0 + p1, like a typed-in session.
    const bFiles = readdirSync(dirFor(walletB)).sort();
    expect(bFiles).toContain("s1__p0.log");
    expect(bFiles).toContain("s1__p1.log");
  });

  it("destination pages are truly re-encrypted: A's key cannot read B's copies", async () => {
    await seed(storeFor(walletA), meta("s1", "t", 1000), 2);
    await migrateSessions(storeFor(walletA), storeFor(walletB));

    // Wallet A's key over B's folder: undecryptable — listMine omits, load throws.
    const wrongKey = new SessionStore(walletA, manualStorage(walletB.address));
    expect(await wrongKey.listMine()).toEqual([]);
    await expect(wrongKey.load("s1")).rejects.toThrow();
  });

  it("is non-destructive: the source dir is byte-identical and still loads under A", async () => {
    const src = storeFor(walletA);
    await seed(src, meta("s1", "t1", 1000), PAGE_SIZE + 5);
    await src.recordMeta(meta("s-empty", "e", 500));
    const before = snapshotDir(dirFor(walletA));

    await migrateSessions(storeFor(walletA), storeFor(walletB));

    expect(snapshotDir(dirFor(walletA))).toEqual(before); // same files, same bytes
    const after = await storeFor(walletA).load("s1");
    expect(after?.messages).toHaveLength(PAGE_SIZE + 5);
  });

  it("is idempotent: a second run copies nothing and duplicates nothing", async () => {
    const src = storeFor(walletA);
    await seed(src, meta("s1", "t1", 2000), PAGE_SIZE + 5);
    await seed(src, meta("s2", "t2", 1000), 3);

    const first = await migrateSessions(storeFor(walletA), storeFor(walletB));
    expect(first.copied).toBe(2);

    const second = await migrateSessions(storeFor(walletA), storeFor(walletB));
    expect(second).toEqual({ copied: 0, skipped: 2, messages: 0 });

    const dst = storeFor(walletB);
    expect((await dst.load("s1"))?.messages).toHaveLength(PAGE_SIZE + 5);
    expect((await dst.load("s2"))?.messages).toHaveLength(3);
  });

  it("resumes an interrupted copy: only the missing tail is appended", async () => {
    const total = 10;
    const k = 4;
    const m = meta("s1", "t", 1000);
    await seed(storeFor(walletA), m, total);
    await seed(storeFor(walletB), m, k); // as if an earlier run stopped after k messages

    const report = await migrateSessions(storeFor(walletA), storeFor(walletB));
    expect(report).toEqual({ copied: 1, skipped: 0, messages: total - k });

    const dstS1 = await storeFor(walletB).load("s1");
    expect(dstS1).toEqual(await storeFor(walletA).load("s1")); // no gaps, no duplicates
    expect(dstS1?.messages).toHaveLength(total);
  });

  it("skips a divergent same-id session and leaves the destination untouched", async () => {
    const m = meta("s1", "t", 1000);
    await seed(storeFor(walletA), m, 3);
    const other: ChatMessage = { role: "user", text: "a different history", ts: 42 };
    await storeFor(walletB).appendMessage(m, other);

    const report = await migrateSessions(storeFor(walletA), storeFor(walletB));
    expect(report).toEqual({ copied: 0, skipped: 1, messages: 0 });
    expect((await storeFor(walletB).load("s1"))?.messages).toEqual([other]);
  });

  it("migrates a meta-only session via recordMeta", async () => {
    await storeFor(walletA).recordMeta(meta("s-empty", "just a title", 777));

    const report = await migrateSessions(storeFor(walletA), storeFor(walletB));
    expect(report).toEqual({ copied: 1, skipped: 0, messages: 0 });

    const listed = await storeFor(walletB).listMine();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ sessionId: "s-empty", title: "just a title", ts: 777 });

    // And a re-run treats it as already present.
    const again = await migrateSessions(storeFor(walletA), storeFor(walletB));
    expect(again).toEqual({ copied: 0, skipped: 1, messages: 0 });
  });

  it("isolates faults: a corrupt source session is counted skipped, healthy ones copy", async () => {
    const src = storeFor(walletA);
    await seed(src, meta("s-ok", "healthy", 2000), 3);
    await seed(src, meta("s-bad", "broken", 1000), PAGE_SIZE + 5); // 2 pages
    // Corrupt the OLDER page: listMine (newest page only) still lists the session,
    // so the migration attempts it and must fail per-session, not abort the run.
    writeFileSync(join(dirFor(walletA), "s-bad__p0.log"), "not an encrypted record\n");

    const report = await migrateSessions(storeFor(walletA), storeFor(walletB));
    expect(report.copied).toBe(1);
    expect(report.skipped).toBe(1);
    expect(report.messages).toBe(3);

    const listed = await storeFor(walletB).listMine();
    expect(listed.map((s) => s.sessionId)).toEqual(["s-ok"]);
    expect((await storeFor(walletB).load("s-ok"))?.messages).toHaveLength(3);
  });

  it("scopes to one session when a sessionId is given: siblings are untouched", async () => {
    const src = storeFor(walletA);
    await seed(src, meta("s1", "wanted", 2000), 3);
    await seed(src, meta("s2", "left local", 1000), 2);

    const report = await migrateSessions(storeFor(walletA), storeFor(walletB), "s1");
    expect(report).toEqual({ copied: 1, skipped: 0, messages: 3 });

    const dst = storeFor(walletB);
    expect((await dst.listMine()).map((s) => s.sessionId)).toEqual(["s1"]);
    expect((await dst.load("s1"))?.messages).toHaveLength(3);
    expect(await dst.load("s2")).toBeNull();

    // An unknown id copies nothing and fails nothing.
    const miss = await migrateSessions(storeFor(walletA), storeFor(walletB), "nope");
    expect(miss).toEqual({ copied: 0, skipped: 0, messages: 0 });
  });

  it("covers the guest-unlock shape: a signMessage-only device wallet migrates into a real wallet", async () => {
    // Mirror of the surface's deviceGuestWallet: session-key signing works, chain signing
    // fails closed. Migration must only ever need signMessage.
    const guest: Wallet = {
      ...testWallet(3),
      async signTransaction() {
        throw new Error("Connect a wallet to use on-chain actions.");
      },
      async signAllTransactions() {
        throw new Error("Connect a wallet to use on-chain actions.");
      },
    } as Wallet;
    await seed(storeFor(guest), meta("g1", "guest chat", 1234), 2);

    const report = await migrateSessions(storeFor(guest), storeFor(walletB));
    expect(report).toEqual({ copied: 1, skipped: 0, messages: 2 });
    expect((await storeFor(walletB).load("g1"))?.messages).toHaveLength(2);
    expect((await storeFor(guest).load("g1"))?.messages).toHaveLength(2); // guest copy intact
  });
});
