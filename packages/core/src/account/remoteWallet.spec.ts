import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { Keypair, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import nacl from "tweetnacl";
import { remoteWallet } from "./remoteWallet.js";

// A stub loopback vault speaking the three-endpoint protocol remoteWallet documents:
// GET /pubkey, POST /sign-transaction, POST /sign-message. It holds one Keypair and
// signs for real (web3.js partialSign for transactions, nacl for messages), so the
// specs check actual signature validity, not just transport plumbing. Flipping
// `refuse` turns it into a policy vault that says no, the 403 path.
const remoteKey = Keypair.generate();
let refuse = false;
let server: Server;
let base: string;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// A minimal legacy transaction the stub can sign: remote key as fee payer, one
// no-op instruction (compileMessage refuses an empty instruction list), plus an
// optional extra required signer for the partial-signature round-trip spec.
function newTx(extraSigner?: Keypair): Transaction {
  return new Transaction({
    feePayer: remoteKey.publicKey,
    // any 32-byte base58 string is a valid blockhash shape for offline serialization
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  }).add(
    new TransactionInstruction({
      keys: extraSigner ? [{ pubkey: extraSigner.publicKey, isSigner: true, isWritable: false }] : [],
      programId: SystemProgram.programId,
      data: Buffer.alloc(0),
    }),
  );
}

beforeAll(async () => {
  server = createServer((req, res) => {
    void (async () => {
      if (refuse) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "policy: spend cap exceeded" }));
        return;
      }
      if (req.method === "GET" && req.url === "/pubkey") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ address: remoteKey.publicKey.toBase58() }));
        return;
      }
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      if (req.method === "POST" && req.url === "/sign-transaction") {
        const tx = Transaction.from(Buffer.from(String(body.transaction), "base64"));
        tx.partialSign(remoteKey);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
        }));
        return;
      }
      if (req.method === "POST" && req.url === "/sign-message") {
        const msg = Buffer.from(String(body.message), "base64");
        const signature = nacl.sign.detached(Uint8Array.from(msg), remoteKey.secretKey);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ signature: Buffer.from(signature).toString("base64") }));
        return;
      }
      res.writeHead(404);
      res.end();
    })().catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("remoteWallet", () => {
  it("resolves the wallet address from the signer's /pubkey (trailing slash tolerated)", async () => {
    const { wallet, address } = await remoteWallet(`${base}/`);
    expect(address).toBe(remoteKey.publicKey.toBase58());
    expect(wallet.publicKey.equals(remoteKey.publicKey)).toBe(true);
  });

  it("sign-transaction round trip keeps a co-signer's pre-added partial signature", async () => {
    const { wallet } = await remoteWallet(base);
    const cosigner = Keypair.generate();
    const tx = newTx(cosigner);
    // the mint/minter-style signature added BEFORE the vault ever sees the tx
    tx.partialSign(cosigner);
    const before = tx.signatures.find((s) => s.publicKey.equals(cosigner.publicKey))?.signature;
    expect(before).toBeTruthy();

    const signed = await wallet.signTransaction(tx);
    expect(signed).toBe(tx); // same object mutated and returned, keypairWallet's contract
    const after = signed.signatures.find((s) => s.publicKey.equals(cosigner.publicKey))?.signature;
    expect(after && before && after.equals(before)).toBe(true); // the partial sig survived
    expect(signed.signatures.find((s) => s.publicKey.equals(remoteKey.publicKey))?.signature).toBeTruthy();
    expect(signed.verifySignatures()).toBe(true); // both signatures verify over the same bytes
  });

  it("sign-message returns the signer's ed25519 signature over the exact fixed message", async () => {
    const { wallet } = await remoteWallet(base);
    const msg = new TextEncoder().encode("agentnet session key derivation, one fixed message");
    const sig = await wallet.signMessage(msg);
    expect(sig).toHaveLength(64);
    expect(nacl.sign.detached.verify(msg, sig, remoteKey.publicKey.toBytes())).toBe(true);
  });

  it("surfaces a policy refusal with the vault's own reason text (403 path)", async () => {
    const { wallet } = await remoteWallet(base); // handshake first, while the vault still answers
    refuse = true;
    try {
      await expect(wallet.signTransaction(newTx())).rejects.toThrow(
        /remote signer refused \(403\): policy: spend cap exceeded/,
      );
    } finally {
      refuse = false;
    }
  });
});
