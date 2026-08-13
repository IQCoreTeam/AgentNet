// On-chain session index (plans/offchain-session-sync.md §4-5) — the `mysessions`
// half of session sync. Storage already carries the encrypted blobs across devices;
// this publishes the LIST ("these sessionIds belong to this wallet") so a brand-new
// device can DISCOVER its sessions before any cloud storage is connected.
//
// Deliberately minimal on-chain (the plan's whole point):
//   - one row per NEW sessionId, written once at creation — updates never touch the
//     chain (integrity lives in the blob's authenticated encryption, not a hash)
//   - row shape = the `Session` type (core/types.ts); `title` stays off-chain —
//     it lives inside the encrypted blob, and a table row is public forever
//   - writers=[owner] ON OUR CREATE. The table PDA derives from the public hint
//     alone, so a squatter who creates it FIRST owns the writer list — see the
//     open finding in the PR: real enforcement needs the contract to bind table
//     creation to the hint's wallet. Until then a squatted table means writes
//     fail (contained below) and rows stay what they always are: untrusted hints.
//
// Everything here is OPT-IN PER WALLET (config.json `sessionIndex` map — see
// login.ts) because a row write is a real Solana transaction: it costs fees and,
// on a web wallet, pops a signature prompt; one device-global flag would let a
// CLI keypair's opt-in surprise-prompt a Phantom wallet on the same machine.
// The write paths are best-effort: an RPC hiccup or a signerless wallet (the
// localhost guest) must never break the chat session they ride on. Chain-only
// entries are DISCOVERY hints, never openable rows — opening a blobless id would
// start writing fresh pages under it and collide with the real pages when that
// storage later connects.

import { readFile, writeFile } from "node:fs/promises";
import { Connection } from "@solana/web3.js";
import { init as initChain, ensureTable, writeRow, readRows } from "../core/chain.js";
import { mysessionsHint, SESSION_COLUMNS } from "../core/seed.js";
import { resolveRpcUrl } from "../core/rpc.js";
import { chainIndexDir, chainIndexFile, ensureDir } from "../core/paths.js";
import { getSessionIndex } from "./login.js";
import type { Session } from "../core/types.js";
import type { SessionMeta, Wallet } from "../runtime/contract.js";

// Read window for the wallet's row list. The gateway pages 100/call under this and
// the SDK fallback's getSignaturesForAddress caps near 1000, so past this point a
// read may be silently missing OLDER rows. Every consumer that dedups paid writes
// against the list must honor `truncated` — writing against a partial view is how
// permanent duplicate rows (and fees) happen.
const READ_LIMIT = 1000;

// The runtime may never have touched the chain layer (a chat session needs no RPC),
// so every entry point routes through this lazy init. Memoized: resolveRpcUrl probes
// the stored Helius key with a live call, and one probe per process is plenty.
let chainReady: Promise<void> | null = null;
function connectChain(): Promise<void> {
  return (chainReady ??= (async () => {
    initChain(new Connection(await resolveRpcUrl(), "confirmed"));
  })());
}

// ── local dedup cache (chain-index/{wallet}.json) ───────────────────────────
// Which sessionIds this device already wrote. The hot path (session creation)
// trusts it to skip a chain read, and backfill trusts it ALONGSIDE the chain
// read: the gateway's view can lag its own notify, so "not on chain yet" is not
// "never written". The chain remains the source of truth — a lost cache costs a
// redundant check, never a lost session.

async function readCache(wallet: string): Promise<Set<string>> {
  try {
    const raw = JSON.parse(await readFile(chainIndexFile(wallet), "utf8")) as { indexed?: unknown };
    return new Set(Array.isArray(raw.indexed) ? raw.indexed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

async function writeCache(wallet: string, indexed: Set<string>): Promise<void> {
  await ensureDir(chainIndexDir());
  await writeFile(chainIndexFile(wallet), JSON.stringify({ indexed: [...indexed] }, null, 2));
}

// One `mysessions` row (the plan's create-time write). Caller gates + catches.
async function writeSessionRow(
  wallet: Wallet,
  sessionId: string,
  cli: "claude" | "codex",
  ts: number,
): Promise<void> {
  const hint = mysessionsHint(wallet.address);
  await ensureTable(wallet, hint, SESSION_COLUMNS, "sessionId", { writers: [wallet.address] });
  const row: Session = { sessionId, modelType: cli, createdAt: ts, updatedAt: ts };
  await writeRow(wallet, hint, JSON.stringify(row));
}

/**
 * Record a freshly-created session on the wallet's on-chain list. Fire-and-forget
 * from the runtime: every guard failure (toggle off for THIS wallet, guest wallet
 * without a signer, RPC down, a squatted table rejecting the write) resolves false
 * and the chat continues untouched. The cache file makes this idempotent without a
 * chain read, so an engine restart never re-pays the tx.
 */
export async function indexNewSession(
  wallet: Wallet,
  sessionId: string,
  cli: "claude" | "codex",
): Promise<boolean> {
  try {
    if (!sessionId || !(await getSessionIndex(wallet.address))) return false;
    const cached = await readCache(wallet.address);
    if (cached.has(sessionId)) return false;
    await connectChain();
    await writeSessionRow(wallet, sessionId, cli, Date.now());
    cached.add(sessionId);
    await writeCache(wallet.address, cached);
    return true;
  } catch (e) {
    console.warn("[session-index] skipped:", e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * The wallet's published session list. Read-only (gateway-first, free), no signer.
 * Chain rows are untrusted input: malformed entries are dropped, and on a duplicate
 * id the OLDEST row wins — both feeds return rows newest-first, so the LAST
 * occurrence is the original create-time write and any later echo is ignored.
 * `truncated` means the window filled and OLDER rows may be missing: display-only
 * consumers may shrug, but paid writes must not dedup against a partial view.
 */
export async function listChainSessions(
  walletAddress: string,
): Promise<{ sessions: Session[]; truncated: boolean }> {
  await connectChain();
  const rows = await readRows(mysessionsHint(walletAddress), { limit: READ_LIMIT });
  const byId = new Map<string, Session>();
  for (const r of rows) {
    const id = typeof r.sessionId === "string" ? r.sessionId : "";
    if (!id) continue;
    byId.set(id, {
      sessionId: id,
      modelType: r.modelType === "codex" ? "codex" : "claude",
      createdAt: Number(r.createdAt) || 0,
      updatedAt: Number(r.updatedAt) || 0,
      ...(typeof r.title === "string" && r.title ? { title: r.title } : {}),
    });
  }
  return { sessions: [...byId.values()], truncated: rows.length >= READ_LIMIT };
}

export interface SessionIndexStatus {
  enabled: boolean;
  /** every row the wallet has published (up to the read window) */
  onChain: Session[];
  /** rows with no blob in this device's storage view — "connect the storage that holds them" */
  chainOnly: Session[];
  /** the read window filled — counts are floors, not totals */
  truncated: boolean;
}

/**
 * The discovery read (plan §5.2): what does the chain say this wallet has, and
 * which of those does this device NOT hold a blob for? `localIds` comes from the
 * caller's listSessions — storage stays the authority on what is openable.
 */
export async function sessionIndexStatus(
  walletAddress: string,
  localIds: Iterable<string>,
): Promise<SessionIndexStatus> {
  const enabled = await getSessionIndex(walletAddress);
  const { sessions: onChain, truncated } = await listChainSessions(walletAddress);
  const have = new Set(localIds);
  return { enabled, onChain, chainOnly: onChain.filter((s) => !have.has(s.sessionId)), truncated };
}

// One backfill per wallet at a time, process-wide. Two concurrent runs would each
// read a chain snapshot that predates the other's writes and double-pay every row —
// re-entry (a double-tapped /sessionsync) must fail loudly, not fork.
const backfillRunning = new Set<string>();

/**
 * One-shot catch-up: publish every session this device holds that neither the
 * chain list NOR the local cache knows (sessions created before indexing was
 * turned on — including on other devices, which is why the chain read matters).
 * Explicit-trigger only — the same contract as StorageAdapter.backfill: never on
 * passive startup. Refuses on a truncated chain view: with older rows invisible,
 * "missing" can't be told from "not fetched", and guessing mints paid duplicates.
 */
export async function backfillSessionIndex(
  wallet: Wallet,
  sessions: SessionMeta[],
): Promise<{ written: number; already: number }> {
  if (!(await getSessionIndex(wallet.address))) {
    throw new Error("session sync is off for this wallet");
  }
  if (backfillRunning.has(wallet.address)) {
    throw new Error("a backfill is already running for this wallet");
  }
  backfillRunning.add(wallet.address);
  const cached = await readCache(wallet.address);
  let written = 0;
  try {
    const { sessions: chainSessions, truncated } = await listChainSessions(wallet.address);
    if (truncated) {
      throw new Error(`chain list exceeds the ${READ_LIMIT}-row read window — refusing to backfill against a partial view`);
    }
    const onChain = new Set(chainSessions.map((s) => s.sessionId));
    for (const s of sessions) {
      if (onChain.has(s.sessionId) || cached.has(s.sessionId)) {
        cached.add(s.sessionId); // repair the cache from chain truth as we pass
        continue;
      }
      await writeSessionRow(wallet, s.sessionId, s.cli, s.ts);
      cached.add(s.sessionId);
      written++;
    }
  } finally {
    backfillRunning.delete(wallet.address);
    // rows already paid for this run stay cached even when a later one threw
    await writeCache(wallet.address, cached).catch(() => {});
  }
  return { written, already: sessions.length - written };
}
