// Local-file StorageAdapter — the PoC backend. Swappable later for gdrive /
// on-chain (same StorageAdapter interface). Stores one file per sessionId under a
// PER-WALLET dir (sessions/{walletAddress}/), so different agents (= wallets) keep
// separate session sets. The blob is already encrypted by the caller (store.ts).

import { mkdir, readFile, writeFile, appendFile, readdir, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import { sessionsDir } from "../../core/paths.js";
import type { StorageAdapter } from "../../runtime/contract.js";

// Path resolved per-call from core/paths (honors AGENTNET_HOME). Resolving at call
// time — not module load — lets a test set AGENTNET_HOME before first use.
const EXT = ".log";

export function manualStorage(walletAddress?: string): StorageAdapter {
  // sessions/{wallet}/ when a wallet is given; the flat sessions/ otherwise (tests).
  const dir = () => (walletAddress ? join(sessionsDir(), walletAddress) : sessionsDir());
  const file = (id: string) => join(dir(), `${id}${EXT}`); // encrypted append-only JSONL

  return {
    async put(sessionId, blob) {
      await mkdir(dir(), { recursive: true });
      await writeFile(file(sessionId), blob);
    },
    // real append — adds the chunk to the file end, no rewrite.
    async append(sessionId, chunk) {
      await mkdir(dir(), { recursive: true });
      await appendFile(file(sessionId), chunk);
    },
    async get(sessionId) {
      try {
        return new Uint8Array(await readFile(file(sessionId)));
      } catch {
        return null;
      }
    },
    async list() {
      try {
        const files = await readdir(dir());
        return files.filter((f) => f.endsWith(EXT)).map((f) => f.slice(0, -EXT.length));
      } catch {
        return [];
      }
    },
    async remove(sessionId) {
      await rm(file(sessionId), { force: true }); // force = no error if already gone
    },
  };
}

// One-time: move pre-wallet-folder local sessions (sessions/*.log) INTO the wallet
// folder (sessions/{wallet}/*.log). Best-effort; safe to call every connect.
export async function migrateLocalSessions(walletAddress: string): Promise<void> {
  const root = sessionsDir();
  const dest = join(root, walletAddress);
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return; // no sessions dir yet
  }
  const loose = entries.filter((f) => f.endsWith(EXT)); // files directly under sessions/
  if (!loose.length) return;
  await mkdir(dest, { recursive: true });
  for (const f of loose) {
    try {
      await rename(join(root, f), join(dest, f));
    } catch {
      /* skip a file that can't be moved */
    }
  }
}
