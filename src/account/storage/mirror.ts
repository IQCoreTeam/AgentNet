// MirrorStorage — local is always on; cloud is an optional mirror.
//   write (put/append/remove) → local, then cloud (best-effort: cloud failure
//     never breaks the local write, so you keep working offline / before connecting).
//   read  (get) → local first, fall back to cloud (a session synced from another device).
//   list  → union of local + cloud, deduped.
// Satisfies StorageAdapter, so runtime/store don't change — this is one layer on top.

import type { StorageAdapter } from "../../runtime/contract.js";

// onCloudStatus (optional): notified after each cloud write attempt — "ok" on
// success, "error" + message on failure. The UI uses it to show whether the drive
// mirror is actually working (cloud writes are best-effort and otherwise silent, so
// a misconfig looked like "nothing uploaded" with no signal).
export type CloudStatus = { ok: true } | { ok: false; error: string };

export function mirrorStorage(
  local: StorageAdapter,
  cloud?: StorageAdapter,
  onCloudStatus?: (s: CloudStatus) => void,
): StorageAdapter {
  // cloud writes are best-effort; swallow errors so local stays the source of truth,
  // but report the outcome so the UI can surface a broken mirror.
  const tryCloud = async (fn: () => Promise<void>) => {
    if (!cloud) return;
    try {
      await fn();
      onCloudStatus?.({ ok: true });
    } catch (e) {
      onCloudStatus?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
      /* offline / not connected — local already succeeded */
    }
  };

  return {
    async put(sessionId, blob) {
      await local.put(sessionId, blob);
      await tryCloud(() => cloud!.put(sessionId, blob));
    },

    async append(sessionId, chunk) {
      if (local.append) await local.append(sessionId, chunk);
      else await local.put(sessionId, chunk);
      await tryCloud(async () => {
        if (cloud!.append) await cloud!.append(sessionId, chunk);
        else {
          // cloud has no append (gdrive/custom): re-upload the whole local blob.
          // TODO(perf): re-uploads the full session every turn -> O(N^2) traffic for
          // long sessions. Fine for short ones. When long sessions matter, batch:
          // flush to cloud every N turns / T seconds (local stays per-turn). See
          // STATUS.md T1-6. Function is correct as-is; this is purely efficiency.
          const full = await local.get(sessionId);
          if (full) await cloud!.put(sessionId, full);
        }
      });
    },

    async get(sessionId) {
      const localBlob = await local.get(sessionId);
      if (localBlob) return localBlob;
      if (!cloud) return null;
      try {
        return await cloud.get(sessionId);
      } catch {
        return null;
      }
    },

    async list() {
      const ids = new Set(await local.list());
      if (cloud) {
        try {
          for (const id of await cloud.list()) ids.add(id);
        } catch {
          /* offline — show what local has */
        }
      }
      return [...ids];
    },

    async remove(sessionId) {
      await local.remove(sessionId);
      await tryCloud(() => cloud!.remove(sessionId));
    },
  };
}
