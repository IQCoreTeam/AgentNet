import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// resolveRpcUrl priority (issue #23): registered Helius key > env > public-devnet
// default. Each test gets a fresh AGENTNET_HOME so the token file is isolated.
describe("core/rpc — resolveRpcUrl priority", () => {
  let home: string;
  const origEnv = { ...process.env };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "agentnet-rpc-"));
    process.env.AGENTNET_HOME = home;
    delete process.env.DAS_RPC_URL;
    delete process.env.SOLANA_RPC_URL;
  });
  afterEach(() => {
    process.env = { ...origEnv };
    rmSync(home, { recursive: true, force: true });
  });

  it("falls back to the public-devnet default when nothing is set", async () => {
    const { resolveRpcUrl } = await import("./rpc.js");
    expect(await resolveRpcUrl()).toContain("api.devnet.solana.com");
  });

  it("uses an env RPC over the default", async () => {
    process.env.SOLANA_RPC_URL = "https://my.rpc/abc";
    const { resolveRpcUrl } = await import("./rpc.js");
    expect(await resolveRpcUrl()).toBe("https://my.rpc/abc");
  });

  it("a registered Helius key wins over env and templates the devnet URL", async () => {
    process.env.SOLANA_RPC_URL = "https://my.rpc/abc";
    const { saveHeliusKey, resolveRpcUrl } = await import("./rpc.js");
    await saveHeliusKey("KEY123");
    const url = await resolveRpcUrl();
    expect(url).toBe("https://devnet.helius-rpc.com/?api-key=KEY123");
  });

  it("hasDasRpc is false on the bare default, true with a Helius key", async () => {
    const { hasDasRpc, saveHeliusKey } = await import("./rpc.js");
    expect(await hasDasRpc()).toBe(false);
    await saveHeliusKey("KEY123");
    expect(await hasDasRpc()).toBe(true);
  });
});
