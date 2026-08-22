// Running Sync markers (issue #129): the two-writes-per-turn protocol, the
// reader rule (running AND expiresAt + grace > now), turn-scoped ends, and the
// deviceId-scoped startup sweep - all over an in-memory StorageAdapter.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunningMarkers, RUNNING_TTL_MS, READER_GRACE_MS, type RunningMarker } from "./runningMarkers.js";
import type { StorageAdapter } from "../runtime/contract.js";

const THIS_DEVICE = "device-aaaa";
let deviceId = THIS_DEVICE;
vi.mock("../core/device.js", () => ({
  getDeviceProfile: vi.fn(() => Promise.resolve({ id: deviceId, label: "test" })),
}));

function memStorage(): StorageAdapter & { blobs: Map<string, Uint8Array> } {
  const blobs = new Map<string, Uint8Array>();
  return {
    blobs,
    put: async (k, b) => void blobs.set(k, b),
    get: async (k) => blobs.get(k) ?? null,
    list: async () => [...blobs.keys()],
    remove: async (k) => void blobs.delete(k),
  };
}

const readMarker = (s: { blobs: Map<string, Uint8Array> }, sessionId: string): RunningMarker =>
  JSON.parse(new TextDecoder().decode(s.blobs.get(`running__${sessionId}`)!));

describe("account/runningMarkers", () => {
  beforeEach(() => {
    deviceId = THIS_DEVICE;
  });

  it("start writes a running marker with the default 20 minute expiry; end overwrites it with ended", async () => {
    const storage = memStorage();
    const markers = new RunningMarkers(storage);

    const before = Date.now();
    const turnId = await markers.start("sess-1");
    const running = readMarker(storage, "sess-1");
    expect(running.state).toBe("running");
    expect(running.deviceId).toBe(THIS_DEVICE);
    expect(running.expiresAt - running.startedAt).toBe(RUNNING_TTL_MS);
    expect(running.startedAt).toBeGreaterThanOrEqual(before);

    await markers.end("sess-1", turnId);
    const ended = readMarker(storage, "sess-1");
    expect(ended.state).toBe("ended");
    expect(ended.turnId).toBe(turnId);
    expect(ended.endedAt).toBeGreaterThanOrEqual(running.startedAt);
  });

  it("end with a stale turnId cannot close a newer turn's marker", async () => {
    const storage = memStorage();
    const markers = new RunningMarkers(storage);

    const oldTurn = await markers.start("sess-1");
    const newTurn = await markers.start("sess-1"); // newer turn owns the file now
    await markers.end("sess-1", oldTurn); // delayed/retried end from the old turn
    expect(readMarker(storage, "sess-1").state).toBe("running");
    expect(readMarker(storage, "sess-1").turnId).toBe(newTurn);
  });

  it("liveRemote lists only other devices' running, unexpired markers", async () => {
    const storage = memStorage();
    const markers = new RunningMarkers(storage);

    deviceId = "device-bbbb"; // another device writes...
    await markers.start("remote-live");
    const endedTurn = await markers.start("remote-ended");
    await markers.end("remote-ended", endedTurn);
    deviceId = THIS_DEVICE; // ...and this device reads
    await markers.start("mine"); // own marker: covered by the local busy set

    expect(await markers.liveRemote()).toEqual(["remote-live"]);
  });

  it("liveRemote treats an expired marker as ended regardless of its state", async () => {
    const storage = memStorage();
    const markers = new RunningMarkers(storage);
    deviceId = "device-bbbb";
    await markers.start("remote-stale");
    deviceId = THIS_DEVICE;

    const past = Date.now() + RUNNING_TTL_MS + READER_GRACE_MS + 1;
    vi.spyOn(Date, "now").mockReturnValue(past);
    try {
      expect(await markers.liveRemote()).toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("sweep force-closes this device's leftover running markers and drops its ended ones, leaving other devices' alone", async () => {
    const storage = memStorage();
    const markers = new RunningMarkers(storage);

    await markers.start("crashed"); // running, never ended (simulated crash)
    const done = await markers.start("finished");
    await markers.end("finished", done);
    deviceId = "device-bbbb";
    await markers.start("theirs");
    deviceId = THIS_DEVICE;

    await markers.sweep();
    expect(readMarker(storage, "crashed").state).toBe("ended");
    expect(storage.blobs.has("running__finished")).toBe(false); // bounded marker set
    expect(readMarker(storage, "theirs").state).toBe("running"); // not ours to touch
  });

  it("ignores a corrupt marker blob instead of failing the list", async () => {
    const storage = memStorage();
    const markers = new RunningMarkers(storage);
    storage.blobs.set("running__bad", new TextEncoder().encode("not json"));
    expect(await markers.liveRemote()).toEqual([]);
    await expect(markers.sweep()).resolves.toBeUndefined();
  });
});
