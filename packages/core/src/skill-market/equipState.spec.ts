import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { readDisposed, disposeMint, undisposeMint } from "./equipState.js";
import { skillsManifestFile, skillStateFile } from "../core/paths.js";

// The equip state is the wallet's un-equip choice: wallet-scoped on disk, adopted once
// from the legacy device-global manifest.disposed list. Point AGENTNET_HOME at a temp
// dir and assert the local tier (cloud sync needs a live wallet + storage; the merge
// there is plain last-write-wins over this same shape).
describe("wallet-scoped equip state", () => {
  let home: string;
  let prevHome: string | undefined;
  const W1 = "WalletAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const W2 = "WalletBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "agentnet-equipstate-"));
    prevHome = process.env.AGENTNET_HOME;
    process.env.AGENTNET_HOME = home;
  });

  afterEach(async () => {
    process.env.AGENTNET_HOME = prevHome;
    await rm(home, { recursive: true, force: true });
  });

  it("disposes a mint (sticky, deduped) then un-disposes it, per wallet", async () => {
    await disposeMint(W1, "MINT_D1");
    await disposeMint(W1, "MINT_D1"); // idempotent — no dupes
    await disposeMint(W1, "MINT_D2");
    expect([...(await readDisposed(W1))].sort()).toEqual(["MINT_D1", "MINT_D2"]);
    // another wallet's state is untouched — the list is wallet-scoped, not device-global
    expect((await readDisposed(W2)).size).toBe(0);

    await undisposeMint(W1, "MINT_D1");
    expect([...(await readDisposed(W1))]).toEqual(["MINT_D2"]);
  });

  it("persists as the documented shape with an updatedAt merge key", async () => {
    const before = Date.now();
    await disposeMint(W1, "MINT_X");
    const onDisk = JSON.parse(await readFile(skillStateFile(W1), "utf8"));
    expect(onDisk.version).toBe(1);
    expect(onDisk.disposed).toEqual(["MINT_X"]);
    expect(onDisk.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("adopts the legacy device-global disposed list on a wallet's first read", async () => {
    const legacy = skillsManifestFile();
    await mkdir(dirname(legacy), { recursive: true });
    await writeFile(legacy, JSON.stringify({ version: 1, nft: {}, disposed: ["MINT_LEGACY"] }));
    expect([...(await readDisposed(W1))]).toEqual(["MINT_LEGACY"]);
    // a wallet with its own state file ignores the legacy list from then on
    await undisposeMint(W1, "MINT_LEGACY");
    expect((await readDisposed(W1)).size).toBe(0);
  });
});
