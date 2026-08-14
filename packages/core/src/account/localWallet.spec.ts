import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { localWallet } from "./localWallet.js";

// The keypair file is a plaintext ed25519 secret key. It used to be written with the
// default 0644 — readable by every local account on a shared machine — while the rest of
// our secrets already used 0600 (rpc.ts) inside 0700 dirs (paths.ts). #150 B3.
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentnet-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const mode = (p: string) => statSync(p).mode & 0o777;

describe("local wallet key permissions", () => {
  it("writes a generated key owner-only, inside an owner-only directory", async () => {
    const path = join(dir, "nested", "id.json");
    const res = await localWallet(path);

    expect(res.created).toBe(true);
    expect(mode(path)).toBe(0o600);
    expect(mode(join(dir, "nested"))).toBe(0o700);
  });

  it("reuses an existing key without touching its permissions", async () => {
    const path = join(dir, "id.json");
    const first = await localWallet(path);
    const second = await localWallet(path);

    expect(second.created).toBe(false);
    expect(second.address).toBe(first.address);
    expect(mode(path)).toBe(0o600);
  });
});
