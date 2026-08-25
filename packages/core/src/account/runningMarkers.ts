// Running Sync (issue #129): cross-device RUNNING state via fixed-TTL markers on
// the SAME StorageAdapter that syncs sessions. A turn writes exactly two markers:
// a `running` mark at turn start and an `ended` overwrite at turn end - no
// renewals, no heartbeat, no cleanup job. Readers treat a marker as live only
// while `state == "running" AND expiresAt (+ grace) > now`, so an abandoned
// marker can never spin forever: expiry is a read-side display decision.
//
// The issue's open questions, resolved conservatively for v1:
// - Placement: ONE MARKER FILE PER SESSION PER DEVICE
//   ("running__{sessionId}__{deviceId}") rather than a single account-wide map
//   or one shared per-session file. Each device only ever writes ITS OWN key,
//   which is what makes the local-first mirror safe: the mirror's get() prefers
//   the local tier, so a shared key would let this device's stale local copy
//   shadow (and its sweep destroy) another device's live cloud marker. With
//   per-device keys another device's marker never exists in our local tier, so
//   reading it always hits the cloud, and the sweep can only touch our own.
// - Expiry classes: the issue's defaults (20 min normal, 60 min deepResearch).
//   No flow sets deepResearch yet; the class is kept here so a known long-running
//   flow can opt in at turn start later without a format change.
// - CLI surface: read-only in v1 - no CLI wiring ships with this module.
//
// Markers are PLAINTEXT json, unlike session/memory blobs: they carry only ids
// and timestamps (never chat content), and the sessionId is already exposed as
// the plaintext storage key of every session page, so encrypting them would cost
// every reader a wallet decrypt per marker per list sync for no added secrecy.
// The device LABEL (hostname) is deliberately NOT stored - only the opaque id.

import { randomUUID } from "node:crypto";
import type { StorageAdapter } from "../runtime/contract.js";
import { getDeviceProfile } from "../core/device.js";

// Hardcoded expiry classes, chosen at turn start (see the issue: fixed windows
// instead of lease renewal - a crashed device's marker dies by construction).
export const RUNNING_TTL_MS = 20 * 60_000;
export const DEEP_RESEARCH_TTL_MS = 60 * 60_000;
// Clock-skew grace on the READER side: expiresAt is compared against the
// reader's own clock; windows are tens of minutes while realistic skew is
// seconds, so a fixed margin is all the clock agreement we ever require.
export const READER_GRACE_MS = 60_000;

export interface RunningMarker {
  sessionId: string;
  turnId: string; // fresh per turn; an `ended` write only closes its own turn
  deviceId: string; // writer's device (core/device.ts id), for the startup sweep
  state: "running" | "ended";
  startedAt: number;
  expiresAt: number;
  endedAt?: number;
  deepResearch?: boolean; // long-flow class (60 min); absent = default (20 min)
}

const PREFIX = "running__";
const markerKey = (sessionId: string, deviceId: string) => `${PREFIX}${sessionId}__${deviceId}`;

// The reader rule: running AND not yet expired on OUR clock (+ grace). An
// expired marker is ended regardless of its state - nobody has to delete it.
function isLive(m: RunningMarker, now: number): boolean {
  return m.state === "running" && m.expiresAt + READER_GRACE_MS > now;
}

export class RunningMarkers {
  constructor(private storage: StorageAdapter) {}

  private async read(key: string, localOnly = false): Promise<RunningMarker | null> {
    const blob = localOnly && this.storage.getLocal
      ? await this.storage.getLocal(key)
      : await this.storage.get(key);
    if (!blob) return null;
    try {
      const m = JSON.parse(new TextDecoder().decode(blob)) as RunningMarker;
      return m && (m.state === "running" || m.state === "ended") && typeof m.expiresAt === "number" ? m : null;
    } catch {
      return null; // unreadable marker = no marker; never break the session list
    }
  }

  private async write(m: RunningMarker): Promise<void> {
    await this.storage.put(markerKey(m.sessionId, m.deviceId), new TextEncoder().encode(JSON.stringify(m)));
  }

  // Turn start -> write the `running` marker (write 1 of 2). Returns the turnId
  // the matching end() must echo, so a delayed/retried end from a previous turn
  // can never kill the badge of a newer turn on the same session.
  async start(sessionId: string, deepResearch = false): Promise<string> {
    const now = Date.now();
    const turnId = randomUUID();
    const device = await getDeviceProfile();
    await this.write({
      sessionId,
      turnId,
      deviceId: device.id,
      state: "running",
      startedAt: now,
      expiresAt: now + (deepResearch ? DEEP_RESEARCH_TTL_MS : RUNNING_TTL_MS),
      ...(deepResearch ? { deepResearch: true } : {}),
    });
    return turnId;
  }

  // Turn end (interrupt lands on the same path) -> overwrite with `ended`
  // (write 2 of 2). Only closes the matching turnId: a newer turn owns the file.
  async end(sessionId: string, turnId: string): Promise<void> {
    const device = await getDeviceProfile();
    const cur = await this.read(markerKey(sessionId, device.id), true);
    if (!cur || cur.turnId !== turnId) return;
    await this.write({ ...cur, state: "ended", endedAt: Date.now() });
  }

  // sessionIds with a LIVE marker written by ANOTHER device. This device's own
  // in-flight turns are already covered by the dispatcher's in-process busy set
  // (and its stale markers are its own ghosts, cleared by sweep), so same-device
  // markers are excluded here.
  async liveRemote(): Promise<string[]> {
    const device = await getDeviceProfile();
    const now = Date.now();
    const keys = (await this.storage.list()).filter((k) => k.startsWith(PREFIX));
    const out: string[] = [];
    await Promise.all(
      keys.map(async (k) => {
        const m = await this.read(k);
        if (m && m.deviceId !== device.id && isLive(m, now)) out.push(m.sessionId);
      }),
    );
    return out;
  }

  // Startup sweep, scoped by deviceId: force-close `running` markers this device
  // left behind (a crash never wrote their `ended` mark), so a restart clears its
  // own ghosts immediately instead of waiting out the expiry window. Ended
  // markers this device wrote are removed: their only job is beating the expiry
  // on live readers, long past by the next boot, and dropping them keeps the
  // per-sync marker read set bounded. LOCAL tier only - this device's markers
  // were written through it, so booting never waits on the cloud (the mirror
  // propagates the fixes best-effort like any other write).
  async sweep(): Promise<void> {
    const list = this.storage.listLocal ? this.storage.listLocal() : this.storage.list();
    const keys = (await list).filter((k) => k.startsWith(PREFIX));
    const device = await getDeviceProfile();
    await Promise.all(
      keys.map(async (k) => {
        const m = await this.read(k, true);
        if (!m || m.deviceId !== device.id) return;
        if (m.state === "running") await this.write({ ...m, state: "ended", endedAt: Date.now() });
        else await this.storage.remove(k);
      }),
    );
  }
}
