import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureTable, writeRow, readRows } from "../core/chain.js";
import { SESSION_COLUMNS } from "../core/seed.js";
import { setSessionIndex, getSessionIndex } from "./login.js";
import {
  indexNewSession,
  listChainSessions,
  sessionIndexStatus,
  backfillSessionIndex,
} from "./sessionIndex.js";
import type { Wallet } from "../runtime/contract.js";

// The chain layer is fully mocked: these tests pin the GATING (opt-in, dedup,
// best-effort, truncation refusal) and the row/table shapes handed to it — the
// layer chain.spec.ts already covers. resolveRpcUrl is mocked so the lazy init
// never probes a key.
vi.mock("../core/chain.js", () => ({
  init: vi.fn(),
  ensureTable: vi.fn().mockResolvedValue(null),
  writeRow: vi.fn().mockResolvedValue("txSig"),
  readRows: vi.fn().mockResolvedValue([]),
}));
vi.mock("../core/rpc.js", () => ({
  resolveRpcUrl: vi.fn().mockResolvedValue("https://api.devnet.solana.com"),
}));

const wallet = { address: "walletA" } as unknown as Wallet;
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agentnet-test-"));
  process.env.AGENTNET_HOME = home;
  vi.mocked(ensureTable).mockClear().mockResolvedValue(null);
  vi.mocked(writeRow).mockClear().mockResolvedValue("txSig");
  vi.mocked(readRows).mockClear().mockResolvedValue([]);
});

afterEach(() => {
  delete process.env.AGENTNET_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("sessionIndex toggle", () => {
  it("defaults OFF — absent flag is not consent to pay for transactions", async () => {
    expect(await getSessionIndex("walletA")).toBe(false);
  });

  it("consent is PER WALLET — one wallet's opt-in never covers another", async () => {
    await setSessionIndex("walletA", true);
    expect(await getSessionIndex("walletA")).toBe(true);
    expect(await getSessionIndex("walletB")).toBe(false);
    await setSessionIndex("walletA", false);
    expect(await getSessionIndex("walletA")).toBe(false);
  });
});

describe("indexNewSession", () => {
  it("does nothing while the wallet's toggle is off", async () => {
    expect(await indexNewSession(wallet, "s1", "claude")).toBe(false);
    expect(writeRow).not.toHaveBeenCalled();
    expect(ensureTable).not.toHaveBeenCalled();
  });

  it("writes one owner-gated row with the Session shape and NO title", async () => {
    await setSessionIndex("walletA", true);
    expect(await indexNewSession(wallet, "s1", "codex")).toBe(true);
    expect(ensureTable).toHaveBeenCalledWith(wallet, "mysessions:walletA", SESSION_COLUMNS, "sessionId", {
      writers: ["walletA"],
    });
    const row = JSON.parse(vi.mocked(writeRow).mock.calls[0][2]);
    expect(row.sessionId).toBe("s1");
    expect(row.modelType).toBe("codex");
    expect(row.createdAt).toBeGreaterThan(0);
    expect(row.updatedAt).toBe(row.createdAt);
    expect("title" in row).toBe(false); // titles stay inside the encrypted blob
  });

  it("is idempotent via the local cache — a restart never re-pays the tx", async () => {
    await setSessionIndex("walletA", true);
    await indexNewSession(wallet, "s1", "claude");
    expect(await indexNewSession(wallet, "s1", "claude")).toBe(false);
    expect(writeRow).toHaveBeenCalledTimes(1);
    const cache = JSON.parse(readFileSync(join(home, "chain-index", "walletA.json"), "utf8"));
    expect(cache.indexed).toEqual(["s1"]);
  });

  it("swallows chain failures and leaves the cache unmarked so a retry can succeed", async () => {
    await setSessionIndex("walletA", true);
    vi.mocked(writeRow).mockRejectedValueOnce(new Error("rpc down"));
    expect(await indexNewSession(wallet, "s1", "claude")).toBe(false); // no throw
    expect(await indexNewSession(wallet, "s1", "claude")).toBe(true); // retried, now cached
    expect(writeRow).toHaveBeenCalledTimes(2);
  });
});

describe("listChainSessions", () => {
  it("drops malformed rows and keeps the OLDEST of a duplicated id (rows arrive newest-first)", async () => {
    vi.mocked(readRows).mockResolvedValue([
      { sessionId: "a", modelType: "codex", createdAt: 9, updatedAt: 9 }, // newer duplicate echo
      { sessionId: "a", modelType: "claude", createdAt: 1, updatedAt: 2 }, // the original create
      { modelType: "claude" }, // no id
      { sessionId: "b", modelType: "weird", createdAt: "3", updatedAt: null },
    ]);
    const { sessions, truncated } = await listChainSessions("walletA");
    expect(truncated).toBe(false);
    expect(sessions).toEqual([
      { sessionId: "a", modelType: "claude", createdAt: 1, updatedAt: 2 },
      { sessionId: "b", modelType: "claude", createdAt: 3, updatedAt: 0 },
    ]);
  });

  it("flags a full read window as truncated", async () => {
    vi.mocked(readRows).mockResolvedValue(
      Array.from({ length: 1000 }, (_, i) => ({ sessionId: `s${i}`, modelType: "claude", createdAt: i, updatedAt: i })),
    );
    expect((await listChainSessions("walletA")).truncated).toBe(true);
  });
});

describe("sessionIndexStatus / backfillSessionIndex", () => {
  it("splits chain rows into held-here vs chain-only", async () => {
    vi.mocked(readRows).mockResolvedValue([
      { sessionId: "here", modelType: "claude", createdAt: 1, updatedAt: 1 },
      { sessionId: "elsewhere", modelType: "claude", createdAt: 2, updatedAt: 2 },
    ]);
    const st = await sessionIndexStatus("walletA", ["here", "local-only"]);
    expect(st.onChain).toHaveLength(2);
    expect(st.chainOnly.map((s) => s.sessionId)).toEqual(["elsewhere"]);
    expect(st.truncated).toBe(false);
  });

  it("backfill refuses while the toggle is off — the gate lives in core, not the surface", async () => {
    await expect(backfillSessionIndex(wallet, [])).rejects.toThrow(/off for this wallet/);
    expect(writeRow).not.toHaveBeenCalled();
  });

  it("backfill writes only sessions neither the chain NOR the cache knows", async () => {
    await setSessionIndex("walletA", true);
    // "c" was written by THIS device moments ago; the gateway view lags and
    // doesn't serve it yet — the cache must stop a duplicate paid row.
    await indexNewSession(wallet, "c", "claude");
    vi.mocked(writeRow).mockClear();
    vi.mocked(readRows).mockResolvedValue([
      { sessionId: "a", modelType: "claude", createdAt: 1, updatedAt: 1 },
    ]);
    const r = await backfillSessionIndex(wallet, [
      { sessionId: "a", title: "t", cli: "claude", ts: 5 },
      { sessionId: "b", title: "t2", cli: "codex", ts: 6 },
      { sessionId: "c", title: "t3", cli: "claude", ts: 7 },
    ]);
    expect(r).toEqual({ written: 1, already: 2 });
    expect(writeRow).toHaveBeenCalledTimes(1);
    const row = JSON.parse(vi.mocked(writeRow).mock.calls[0][2]);
    expect(row.sessionId).toBe("b");
    expect("title" in row).toBe(false);
    // the cache repaired itself from chain truth for "a" too
    const cache = JSON.parse(readFileSync(join(home, "chain-index", "walletA.json"), "utf8"));
    expect(cache.indexed.sort()).toEqual(["a", "b", "c"]);
  });

  it("backfill refuses a truncated chain view instead of minting duplicates", async () => {
    await setSessionIndex("walletA", true);
    vi.mocked(readRows).mockResolvedValue(
      Array.from({ length: 1000 }, (_, i) => ({ sessionId: `s${i}`, modelType: "claude", createdAt: i, updatedAt: i })),
    );
    await expect(
      backfillSessionIndex(wallet, [{ sessionId: "old", title: "t", cli: "claude", ts: 1 }]),
    ).rejects.toThrow(/partial view/);
    expect(writeRow).not.toHaveBeenCalled();
  });

  it("rejects a concurrent backfill for the same wallet — two runs would double-pay", async () => {
    await setSessionIndex("walletA", true);
    let release!: () => void;
    vi.mocked(writeRow).mockImplementationOnce(
      () => new Promise((res) => { release = () => res("txSig"); }),
    );
    const first = backfillSessionIndex(wallet, [{ sessionId: "b", title: "t", cli: "codex", ts: 6 }]);
    await vi.waitFor(() => expect(writeRow).toHaveBeenCalled());
    await expect(
      backfillSessionIndex(wallet, [{ sessionId: "b", title: "t", cli: "codex", ts: 6 }]),
    ).rejects.toThrow(/already running/);
    release();
    expect(await first).toEqual({ written: 1, already: 0 });
  });

  it("keeps rows already paid for in the cache even when a later write throws", async () => {
    await setSessionIndex("walletA", true);
    vi.mocked(writeRow)
      .mockResolvedValueOnce("txSig")
      .mockRejectedValueOnce(new Error("rpc died mid-run"));
    await expect(
      backfillSessionIndex(wallet, [
        { sessionId: "b", title: "t", cli: "codex", ts: 6 },
        { sessionId: "d", title: "t", cli: "claude", ts: 7 },
      ]),
    ).rejects.toThrow(/rpc died/);
    const cache = JSON.parse(readFileSync(join(home, "chain-index", "walletA.json"), "utf8"));
    expect(cache.indexed).toEqual(["b"]); // paid row remembered; failed one retryable
  });
});
