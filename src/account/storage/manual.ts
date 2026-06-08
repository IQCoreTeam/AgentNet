// Local-file StorageAdapter — the PoC backend. Swappable later for gdrive /
// on-chain (same StorageAdapter interface). Stores one file per sessionId under
// a fixed dir; the blob is already encrypted by the caller (store.ts).

import { mkdir, readFile, writeFile, appendFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { sessionsDir } from "../../core/paths.js";
import type { StorageAdapter } from "../../runtime/contract.js";

// Path resolved per-call from core/paths (honors AGENTNET_HOME). Resolving at call
// time — not module load — lets a test set AGENTNET_HOME before first use without
// fighting import hoisting, so tests never pollute the real ~/.agentnet.
const EXT = ".log";
const dir = () => sessionsDir();
const file = (id: string) => join(dir(), `${id}${EXT}`); // encrypted append-only JSONL

export function manualStorage(): StorageAdapter {
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
