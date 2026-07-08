// Two-way SOUL.md file sync — inject / capture / steady-state no-op, against a temp
// dir and an in-memory storage (crypto is real; AGENTNET_HOME isolated for lastWriter).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import type { StorageAdapter, Wallet } from "../../runtime/contract.js";

function memStorage(): StorageAdapter {
  const blobs = new Map<string, Uint8Array>();
  return {
    async put(k, b) { blobs.set(k, b); },
    async get(k) { return blobs.get(k) ?? null; },
    async list() { return [...blobs.keys()]; },
    async remove(k) { blobs.delete(k); },
  };
}

describe("soul/convert/openclaw — syncSoulWithFile", () => {
  let home: string;
  let dir: string;
  let file: string;
  let store: import("../store.js").SoulStore;
  let sync: typeof import("./openclaw.js").syncSoulWithFile;
  const origEnv = { ...process.env };

  beforeEach(async () => {
    vi.resetModules();
    home = mkdtempSync(join(tmpdir(), "agentnet-soulsync-home-"));
    dir = mkdtempSync(join(tmpdir(), "agentnet-soulsync-"));
    file = join(dir, "SOUL.md");
    process.env.AGENTNET_HOME = home;
    const { SoulStore } = await import("../store.js");
    const { keypairWallet } = await import("../../account/keypairWallet.js");
    const wallet: Wallet = keypairWallet(Keypair.generate());
    store = new SoulStore(wallet, memStorage());
    sync = (await import("./openclaw.js")).syncSoulWithFile;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    rmSync(home, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it("neither side → none", async () => {
    expect(await sync(store, file)).toBe("none");
  });

  it("vault only → injected (file created with the doc text)", async () => {
    await store.save("# Luna\n\n## Style\n- terse");
    expect(await sync(store, file)).toBe("injected");
    expect(await readFile(file, "utf8")).toContain("# Luna");
    // steady state: second sync is a no-op even though the file's mtime is newer now
    expect(await sync(store, file)).toBe("none");
  });

  it("file only → captured into the vault", async () => {
    await writeFile(file, "# HostAuthored\n\n## Bio\n- came from openclaw");
    expect(await sync(store, file)).toBe("captured");
    expect((await store.load())!.text).toContain("HostAuthored");
  });

  it("both differ, file newer → captured; doc newer → injected", async () => {
    await store.save("vault version");
    // make the file strictly newer than the doc's lastWriter.ts
    await writeFile(file, "file version");
    const future = new Date(Date.now() + 5000);
    await utimes(file, future, future);
    expect(await sync(store, file)).toBe("captured");
    expect((await store.load())!.text).toBe("file version");

    // now the doc is newer (save stamps a fresh ts) and differs → inject wins
    await new Promise((r) => setTimeout(r, 10));
    await store.save("vault v2");
    const past = new Date(Date.now() - 60_000);
    await utimes(file, past, past);
    expect(await sync(store, file)).toBe("injected");
    expect(await readFile(file, "utf8")).toContain("vault v2");
  });
});
