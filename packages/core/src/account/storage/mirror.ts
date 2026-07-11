// MirrorStorage — local is always on; cloud is an optional mirror.
//   write (put/append/remove) → local, then cloud (best-effort: cloud failure
//     never breaks the local write, so you keep working offline / before connecting).
//   read  (get) → local first, fall back to cloud (a session synced from another device).
//   list  → union of local + cloud, deduped.
// Satisfies StorageAdapter, so runtime/store don't change — this is one layer on top.

import type { CloudListState, StorageAdapter } from "../../runtime/contract.js";

// onCloudStatus (optional): notified after each cloud write attempt — "ok" on
// success, "error" + message on failure. The UI uses it to show whether the drive
// mirror is actually working (cloud writes are best-effort and otherwise silent, so
// a misconfig looked like "nothing uploaded" with no signal).
// reason lets the UI react precisely: "reauth" = the cloud sign-in is DEAD (Google
// invalid_grant — refresh token expired/revoked); only the user reconnecting fixes it
// (Google mandates interactive consent, no silent recovery). "transient" = a network /
// 5xx / timeout that auto-retry could not clear this round (will re-sync on a later write
// or reconnect). Splitting these is what turns a silently-drifting mirror into a visible,
// actionable state. See memory: agentnet-gdrive-testing-token-expiry.
export type CloudStatus =
  | { ok: true }
  | { ok: false; error: string; reason: "reauth" | "transient" };

// A dead sign-in can't be retried away (needs the user); everything else is worth a few
// quick silent retries. Match Google's OAuth error codes plus a generic "reauth" marker.
function isReauthError(msg: string): boolean {
  return /invalid_grant|invalid_client|unauthorized_client|\breauth\b/i.test(msg);
}

// A cloud op with no timeout can hang forever (Drive fetches set none), wedging the write
// path. Bound each attempt so a stalled upload fails fast and the retry/report can proceed.
const CLOUD_OP_TIMEOUT_MS = 30_000;
function withCloudTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error("cloud op timed out")), CLOUD_OP_TIMEOUT_MS);
  });
  // Always clear the timer once the race settles — a bare race left a live 30s timer per
  // call, so a burst of writes piled up dozens of them (each pinning the event loop).
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export function mirrorStorage(
  local: StorageAdapter,
  cloud?: StorageAdapter,
  onCloudStatus?: (s: CloudStatus) => void,
): StorageAdapter {
  // Cloud writes are best-effort (local is the source of truth), but "best-effort" must
  // not mean "fail silently" — that hid a dead Drive sign-in for days. Now: retry a
  // TRANSIENT failure a few times (a network hiccup self-heals), NEVER retry a REAUTH
  // failure (pointless — the token is dead), and always report the CLASSIFIED outcome so
  // the UI can prompt a reconnect instead of drifting out of sync unnoticed.
  const tryCloud = async (fn: () => Promise<void>) => {
    if (!cloud) return;
    const MAX = 3;
    let lastErr = "";
    for (let attempt = 1; attempt <= MAX; attempt++) {
      try {
        await withCloudTimeout(fn());
        onCloudStatus?.({ ok: true });
        return;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        if (isReauthError(lastErr)) {
          onCloudStatus?.({ ok: false, error: lastErr, reason: "reauth" });
          return; // dead sign-in: retrying can't help — surface it for reconnect now
        }
        if (attempt < MAX) {
          await new Promise((r) => setTimeout(r, 300 * attempt * attempt)); // 300ms, 1.2s
        }
      }
    }
    onCloudStatus?.({ ok: false, error: lastErr, reason: "transient" });
    /* local already succeeded; a later write or a reconnect re-syncs the cloud */
  };

  // A cloud tier WITHOUT append (gdrive/custom) mirrors a turn by re-uploading the whole
  // session blob. Doing that every turn is O(N^2) traffic (a 20-tool-call turn = 20 full
  // uploads). Instead COALESCE: mark the session dirty and, a short debounce after writes
  // settle, upload its LATEST local blob exactly once. Local (source of truth) still writes
  // every turn; a flush missed to a crash/exit is reconciled by backfill() on reconnect.
  const FLUSH_DEBOUNCE_MS = 2500;
  const pendingFlush = new Map<string, ReturnType<typeof setTimeout>>();
  const cancelFlush = (sessionId: string) => {
    const t = pendingFlush.get(sessionId);
    if (t) { clearTimeout(t); pendingFlush.delete(sessionId); }
  };
  const scheduleCloudFlush = (sessionId: string) => {
    cancelFlush(sessionId);
    const t = setTimeout(() => {
      pendingFlush.delete(sessionId);
      void tryCloud(async () => {
        const full = await local.get(sessionId);
        if (full) await cloud!.put(sessionId, full);
      });
    }, FLUSH_DEBOUNCE_MS);
    t.unref?.();
    pendingFlush.set(sessionId, t);
  };

  // Outcome of the most recent list() union. Starts "ok" when a cloud is configured
  // (nothing has failed yet); flips per list() call. "none" is a configuration fact.
  let lastListState: CloudListState = cloud ? "ok" : "none";

  return {
    async put(sessionId, blob) {
      await local.put(sessionId, blob);
      cancelFlush(sessionId); // this full write supersedes any pending debounced flush
      await tryCloud(() => cloud!.put(sessionId, blob));
    },

    async append(sessionId, chunk) {
      if (local.append) await local.append(sessionId, chunk);
      else await local.put(sessionId, chunk);
      if (!cloud) return;
      if (cloud.append) {
        // cloud supports append: mirror the chunk incrementally, per turn (cheap).
        await tryCloud(() => cloud.append!(sessionId, chunk));
      } else {
        // no cloud append: coalesce full-blob re-uploads instead of one per turn.
        scheduleCloudFlush(sessionId);
      }
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
        const t0 = Date.now();
        try {
          for (const id of await withCloudTimeout(cloud.list())) ids.add(id);
          if (process.env.AGENTNET_PERF) console.error(`[perf] cloud.list ${Date.now() - t0}ms`);
          lastListState = "ok";
        } catch (e) {
          // The union silently degrading to local-only is how a dead sign-in hid whole
          // devices' sessions with no signal (issue #107 follow-up). Classify + record so
          // the session list can SAY it is local-only, and report through the same status
          // channel writes use.
          const msg = e instanceof Error ? e.message : String(e);
          lastListState = isReauthError(msg) ? "reauth" : "transient";
          onCloudStatus?.({ ok: false, error: msg, reason: lastListState });
        }
      }
      return [...ids];
    },

    // How the last list() union went: "none" = no cloud configured (local-only by
    // choice), "ok" = union included the cloud, "reauth"/"transient" = the cloud tier
    // FAILED and the union is silently local-only (reauth needs the user; transient may
    // self-heal). Surfaces tag the session list with this so "local only" is visible.
    cloudState: () => lastListState,

    // Fast, local-only listing (no network). The session store uses this to find a
    // session's newest page without a Drive round-trip when local already holds it —
    // local is always written first, so a session used on this device is fully local.
    listLocal: () => local.list(),

    // Fast, local-only read (no network). Symmetric to listLocal: the resume paint path
    // reads JUST the local tier here so it can NEVER block on a stalled Drive download —
    // a hung cloud read used to leave "Resuming…" spinning forever. A session used on this
    // device is fully local (local is written first), so this returns its pages instantly;
    // the cloud is reconciled OFF the paint path.
    getLocal: (sessionId) => local.get(sessionId),

    async remove(sessionId) {
      cancelFlush(sessionId); // don't re-upload a session we're deleting
      await local.remove(sessionId);
      await tryCloud(() => cloud!.remove(sessionId));
    },

    // One-shot reconciliation: upload local keys the cloud is missing (sessions written
    // while the cloud sign-in was dead never got mirrored). Deliberately frugal — a
    // surface calls this ONLY right after an explicit (re)connect, never on a timer or
    // passive startup, so it can't become a cloud storm:
    //   - exactly ONE cloud.list() (local.list is offline) to compute the diff;
    //   - uploads ONLY the genuinely-missing keys (0 when already in sync);
    //   - bounded concurrency so a large first sync trickles instead of bursting;
    //   - aborts immediately if the cloud is dead again (no hammering a bad token).
    // local and cloud share one keyspace (that is what list()'s union relies on), so a
    // plain key diff is correct regardless of paging granularity.
    async backfill() {
      if (!cloud) return { uploaded: 0, missing: 0 };
      let cloudKeys: string[];
      try {
        cloudKeys = await withCloudTimeout(cloud.list());
      } catch {
        return { uploaded: 0, missing: 0 }; // cloud unreachable/dead — nothing to do now
      }
      const inCloud = new Set(cloudKeys);
      const missing = (await local.list()).filter((k) => !inCloud.has(k));
      let uploaded = 0;
      const CONCURRENCY = 4;
      for (let i = 0; i < missing.length; i += CONCURRENCY) {
        const batch = missing.slice(i, i + CONCURRENCY);
        let deadSignIn = false;
        await Promise.all(
          batch.map(async (key) => {
            const blob = await local.get(key);
            if (!blob) return;
            try {
              await withCloudTimeout(cloud.put(key, blob));
              uploaded++;
            } catch (e) {
              // A dead sign-in mid-run means the whole rest is pointless — stop, don't
              // grind through hundreds of doomed uploads. Transient misses just stay
              // missing; the next reconnect (or a future write) picks them up.
              if (isReauthError(e instanceof Error ? e.message : String(e))) deadSignIn = true;
            }
          }),
        );
        if (deadSignIn) break;
      }
      return { uploaded, missing: missing.length };
    },
  };
}
