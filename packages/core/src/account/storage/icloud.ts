// iCloud Drive StorageAdapter — just a local folder that macOS syncs for us.
// We write files into the user's iCloud Drive path; the OS handles the sync to
// their other Apple devices. No API, no tokens — that's the whole point of
// "icloud = local folder" (decided with zo). Supports append for fast writes.
//
// Default location is the iCloud Drive container; the user can point `folder`
// anywhere (login.ts saves it in StorageConfig.location).

import { mkdir, readFile, writeFile, readdir, appendFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { StorageAdapter } from "../../runtime/contract.js";

// macOS iCloud Drive root for the user's documents.
function defaultIcloudDir(): string {
  return join(
    homedir(),
    "Library",
    "Mobile Documents",
    "com~apple~CloudDocs",
    "AgentNet",
  );
}

export function icloudStorage(folder?: string): StorageAdapter {
  const dir = folder || defaultIcloudDir();
  const path = (sessionId: string) => join(dir, `${sessionId}.bin`);

  return {
    async put(sessionId, blob) {
      await mkdir(dir, { recursive: true });
      await writeFile(path(sessionId), blob);
    },
    async append(sessionId, chunk) {
      await mkdir(dir, { recursive: true });
      await appendFile(path(sessionId), chunk);
    },
    async get(sessionId) {
      try {
        return new Uint8Array(await readFile(path(sessionId)));
      } catch {
        return null;
      }
    },
    async list() {
      try {
        const files = await readdir(dir);
        return files.filter((f) => f.endsWith(".bin")).map((f) => f.slice(0, -4));
      } catch {
        return [];
      }
    },
    async remove(sessionId) {
      await rm(path(sessionId), { force: true });
    },
  };
}
