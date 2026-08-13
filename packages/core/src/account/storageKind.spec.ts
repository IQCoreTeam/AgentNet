import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isStorageKind } from "./storage/adapter.js";
import { initialize, isCloudConnected, currentStorageKind, getStorageInfo } from "./login.js";

// A storage kind this build can't construct (hand-edited config, a backend removed in a
// downgrade) used to reach buildStorage and throw inside the connect path, killing the
// host process on EVERY launch — an install that could only be recovered by deleting
// config.json. #150 B2.
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agentnet-test-"));
  process.env.AGENTNET_HOME = home;
});

afterEach(() => {
  delete process.env.AGENTNET_HOME;
  rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("storage kind validation", () => {
  it("accepts every kind the registry can build, and nothing else", () => {
    for (const k of ["local", "gdrive", "icloud", "custom"]) expect(isStorageKind(k)).toBe(true);
    for (const k of ["dropbox", "", "toString", null, undefined, 7]) expect(isStorageKind(k)).toBe(false);
  });

  it("treats an unbuildable persisted kind as no cloud instead of throwing", async () => {
    writeFileSync(join(home, "config.json"), JSON.stringify({ kind: "dropbox" }));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // every consumer of the storage choice agrees: no cloud configured, so callers fall
    // back to local-only rather than building (and crashing on) an unknown backend.
    await expect(isCloudConnected()).resolves.toBe(false);
    await expect(currentStorageKind()).resolves.toBeNull();
    await expect(getStorageInfo()).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it("still reads a valid persisted kind", async () => {
    writeFileSync(join(home, "config.json"), JSON.stringify({ kind: "icloud", location: "/tmp/x" }));
    await expect(currentStorageKind()).resolves.toBe("icloud");
  });

  it("refuses to persist an unknown kind", async () => {
    writeFileSync(join(home, "config.json"), JSON.stringify({ kind: "local" }));
    await expect(initialize({ kind: "dropbox" } as never)).rejects.toThrow(/unknown storage kind/);
    // the previous choice survives — a rejected connect must not corrupt the config
    expect(JSON.parse(readFileSync(join(home, "config.json"), "utf8")).kind).toBe("local");
  });
});
