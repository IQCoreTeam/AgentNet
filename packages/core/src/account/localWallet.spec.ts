import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Keypair, PublicKey } from "@solana/web3.js";
import { localWallet, exportKeypair, importKeypair, parseSecretKey, keypairFileText } from "./localWallet.js";
import { base58Decode } from "./base58.js";

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

// Export/import move ONE wallet between devices (My Wallet → Export secret key, paste it
// on the other device). A wrong paste must never cost the wallet already on the device.
describe("local wallet export / import", () => {
  it("base58Decode matches web3's own encoding", () => {
    const pk = Keypair.generate().publicKey;
    expect(base58Decode(pk.toBase58())).toEqual(pk.toBytes());
    expect(new PublicKey(base58Decode("11111111111111111111111111111111")).toBase58()).toBe(
      "11111111111111111111111111111111",
    ); // leading-zero bytes survive
  });

  it("parses the keypair-file JSON array and a base58 secret key to the same wallet", () => {
    const kp = Keypair.generate();
    // A PublicKey only wraps 32 bytes, so encode the 64-byte secret by hand (the inverse
    // of base58Decode) to stand in for what Phantom's "export private key" produces.
    const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let n = 0n;
    for (const byte of kp.secretKey) n = (n << 8n) + BigInt(byte);
    let encoded = "";
    while (n > 0n) {
      encoded = alphabet[Number(n % 58n)] + encoded;
      n /= 58n;
    }
    expect(parseSecretKey(keypairFileText(kp)).publicKey.toBase58()).toBe(kp.publicKey.toBase58());
    expect(parseSecretKey(`  ${encoded}\n`).publicKey.toBase58()).toBe(kp.publicKey.toBase58());
    expect(() => parseSecretKey("")).toThrow(/Paste a secret key/);
    expect(() => parseSecretKey("[1,2,3]")).toThrow(/not a Solana secret key/);
    expect(() => parseSecretKey("not-a-key!")).toThrow(/not a Solana secret key/);
  });

  it("exports exactly the file text, and refuses a file that is not the connected wallet", async () => {
    const path = join(dir, "id.json");
    const res = await localWallet(path);
    const text = await exportKeypair(path, res.address);
    expect(parseSecretKey(text).publicKey.toBase58()).toBe(res.address);
    await expect(exportKeypair(path, Keypair.generate().publicKey.toBase58())).rejects.toThrow(/does not match/);
  });

  it("import writes the pasted key owner-only and moves a different existing key aside", async () => {
    const path = join(dir, "id.json");
    const original = await localWallet(path);
    const incoming = Keypair.generate();

    const imported = await importKeypair(path, keypairFileText(incoming));
    expect(imported.address).toBe(incoming.publicKey.toBase58());
    expect(mode(path)).toBe(0o600);
    expect(imported.replaced).toMatch(/id\.json\.replaced-\d+$/);
    // the wallet that was there is intact in the moved-aside file
    expect((await localWallet(imported.replaced!)).address).toBe(original.address);
    // the device now opens the imported wallet
    expect((await localWallet(path)).address).toBe(incoming.publicKey.toBase58());

    // re-importing the same key is a no-op: nothing moved aside
    const again = await importKeypair(path, keypairFileText(incoming));
    expect(again.replaced).toBeNull();
  });

  it("import into an empty slot just writes the key", async () => {
    const path = join(dir, "fresh", "id.json");
    const incoming = Keypair.generate();
    const imported = await importKeypair(path, keypairFileText(incoming));
    expect(imported.replaced).toBeNull();
    expect(mode(path)).toBe(0o600);
    expect(mode(join(dir, "fresh"))).toBe(0o700);
  });
});
