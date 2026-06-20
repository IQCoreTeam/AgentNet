import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { webWallet } from "./webWallet.js";

describe("webWallet", () => {
  it("round-trips legacy transactions without dropping partial signatures", async () => {
    const walletKeypair = Keypair.generate();
    const mintKeypair = Keypair.generate();
    const tx = new Transaction({
      feePayer: walletKeypair.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
    }).add(
      new TransactionInstruction({
        programId: PublicKey.default,
        keys: [{ pubkey: mintKeypair.publicKey, isSigner: true, isWritable: true }],
        data: Buffer.alloc(0),
      }),
    );
    tx.partialSign(mintKeypair);

    const signer = webWallet(walletKeypair.publicKey.toBase58(), new Uint8Array(64), async (txBase64) => {
      const unsigned = Transaction.from(Buffer.from(txBase64, "base64"));
      const mintSignature = unsigned.signatures.find(({ publicKey }) => publicKey.equals(mintKeypair.publicKey))?.signature;
      expect(mintSignature).toBeTruthy();
      unsigned.partialSign(walletKeypair);
      return unsigned.serialize().toString("base64");
    });

    const signed = await signer.signTransaction(tx);

    expect(signed.verifySignatures()).toBe(true);
  });

  it("fails loudly when no wallet transport is provided", async () => {
    const signer = webWallet(Keypair.generate().publicKey.toBase58(), new Uint8Array(64));

    await expect(signer.signTransaction(new Transaction())).rejects.toThrow("on-chain signing not wired");
  });
});
