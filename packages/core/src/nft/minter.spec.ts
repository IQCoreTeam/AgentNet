import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Keypair } from "@solana/web3.js";
import { resolveMinter, tryMinterPubkey, resetMinterCache } from "./minter.js";

const SECRET = "AGENTNET_MINTER_SECRET";
const PUBKEY = "AGENTNET_MINTER_PUBKEY";

describe("nft/minter", () => {
  beforeEach(() => {
    delete process.env[SECRET];
    delete process.env[PUBKEY];
    resetMinterCache();
  });

  afterEach(() => {
    delete process.env[SECRET];
    delete process.env[PUBKEY];
    resetMinterCache();
  });

  it("resolveMinter returns the override when given one", () => {
    const kp = Keypair.generate();
    expect(resolveMinter(kp)).toBe(kp);
  });

  it("resolveMinter throws when nothing is configured", () => {
    expect(() => resolveMinter()).toThrow(/not configured/);
  });

  it("resolveMinter parses a JSON byte-array secret from env", () => {
    const kp = Keypair.generate();
    process.env[SECRET] = JSON.stringify(Array.from(kp.secretKey));
    expect(resolveMinter().publicKey.toBase58()).toBe(kp.publicKey.toBase58());
  });

  it("resolveMinter rejects a non-array secret", () => {
    process.env[SECRET] = "not-an-array";
    expect(() => resolveMinter()).toThrow(/JSON byte array/);
  });

  it("tryMinterPubkey returns null when unconfigured (publish stays open)", () => {
    expect(tryMinterPubkey()).toBeNull();
  });

  it("tryMinterPubkey prefers an explicit pubkey override", () => {
    const kp = Keypair.generate();
    expect(tryMinterPubkey(kp.publicKey)?.toBase58()).toBe(kp.publicKey.toBase58());
  });

  it("tryMinterPubkey reads AGENTNET_MINTER_PUBKEY without needing the secret", () => {
    const kp = Keypair.generate();
    process.env[PUBKEY] = kp.publicKey.toBase58();
    expect(tryMinterPubkey()?.toBase58()).toBe(kp.publicKey.toBase58());
  });

  it("tryMinterPubkey derives the pubkey from the secret when only the secret is set", () => {
    const kp = Keypair.generate();
    process.env[SECRET] = JSON.stringify(Array.from(kp.secretKey));
    expect(tryMinterPubkey()?.toBase58()).toBe(kp.publicKey.toBase58());
  });
});
