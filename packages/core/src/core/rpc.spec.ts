import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
    vi.unstubAllGlobals();
    rmSync(home, { recursive: true, force: true });
  });

  it("falls back to the public network default when nothing is set", async () => {
    const { resolveRpcUrl } = await import("./rpc.js");
    const { getPublicRpcUrl } = await import("./seed.js");
    expect(await resolveRpcUrl()).toBe(getPublicRpcUrl()); // network-agnostic: follows seed.ts
  });

  it("uses an env RPC over the default", async () => {
    process.env.SOLANA_RPC_URL = "https://my.rpc/abc";
    const { resolveRpcUrl } = await import("./rpc.js");
    expect(await resolveRpcUrl()).toBe("https://my.rpc/abc");
  });

  it("a registered, WORKING Helius key wins over env and templates the central-network URL", async () => {
    process.env.SOLANA_RPC_URL = "https://my.rpc/abc";
    // resolveRpcUrl now probes the key (getVersion) before trusting it — stub a live reply.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ result: { "solana-core": "2.0.0" } }) }));
    const { saveHeliusKey, resolveRpcUrl, heliusUrl } = await import("./rpc.js");
    await saveHeliusKey("KEY123");
    const url = await resolveRpcUrl();
    // templated on the central NETWORK (seed.ts); assert against that, not a hardcoded net.
    expect(url).toBe(heliusUrl("KEY123"));
  });

  it("falls back to env/public when a stored Helius key is dead (Unauthorized)", async () => {
    process.env.SOLANA_RPC_URL = "https://my.rpc/abc";
    // A key that answers getHealth but returns -32401 on real reads must NOT brick reads.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ error: { code: -32401, message: "Unauthorized" } }) }));
    const { saveHeliusKey, resolveRpcUrl } = await import("./rpc.js");
    await saveHeliusKey("DEADKEY");
    expect(await resolveRpcUrl()).toBe("https://my.rpc/abc");
  });

  it("hasDasRpc is false with no key and true only when the stored key actually works", async () => {
    // reflects reality, not presence: a live probe (getVersion) is required, not just a saved key.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ result: { "solana-core": "2.0.0" } }) }));
    const { hasDasRpc, saveHeliusKey } = await import("./rpc.js");
    expect(await hasDasRpc()).toBe(false); // no key, no env RPC
    await saveHeliusKey("LIVEKEYAAAA");
    expect(await hasDasRpc()).toBe(true);
  });

  it("hasDasRpc is false when the stored key is rejected (presence is not enough)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ error: { code: -32401, message: "Unauthorized" } }) }));
    const { hasDasRpc, saveHeliusKey } = await import("./rpc.js");
    await saveHeliusKey("DEADKEYBBBB");
    expect(await hasDasRpc()).toBe(false);
  });

  it("hasDasRpc follows the env RPC a dead key falls back to (it must agree with resolveRpcUrl)", async () => {
    // The regression: a PRESENT but dead key used to short-circuit the env check, so the
    // market showed "add a Helius key" while every read was already served by a working
    // DAS-capable env RPC (and codex lost the whole MCP server via runtime's hasDasRpc gate).
    process.env.DAS_RPC_URL = "https://das.example/rpc";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ error: { code: -32401, message: "Unauthorized" } }) }));
    const { hasDasRpc, saveHeliusKey, resolveRpcUrl } = await import("./rpc.js");
    await saveHeliusKey("DEADKEYCCCC"); // distinct key = distinct URL = its own probe entry
    expect(await resolveRpcUrl()).toBe("https://das.example/rpc"); // reads DO go to the env RPC
    expect(await hasDasRpc()).toBe(true); // so the status must not claim there is none
  });

  it("maskedHeliusKey shows only the last 4 chars (null when no key)", async () => {
    const { maskedHeliusKey, saveHeliusKey } = await import("./rpc.js");
    expect(await maskedHeliusKey()).toBeNull();
    await saveHeliusKey("abcdef1234WXYZ");
    expect(await maskedHeliusKey()).toBe("••••WXYZ");
  });

  it("clearing the key (empty string) falls back to the default", async () => {
    const { saveHeliusKey, resolveRpcUrl, loadHeliusKey } = await import("./rpc.js");
    const { getPublicRpcUrl } = await import("./seed.js");
    await saveHeliusKey("KEY123");
    await saveHeliusKey(""); // clear
    expect(await loadHeliusKey()).toBeNull();
    expect(await resolveRpcUrl()).toBe(getPublicRpcUrl());
  });
});
