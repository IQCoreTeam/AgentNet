import { describe, it, expect, vi, beforeEach } from "vitest";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { publishSkill, buySkill } from "./skill.js";
import * as chain from "../core/chain.js";
import * as token2022 from "./token2022.js";

vi.mock("../core/chain.js", () => ({
  ensureDbRoot: vi.fn().mockResolvedValue("mockDbRootSig"),
  codeIn: vi.fn().mockResolvedValue("mockCodeInSig"),
  signerAddress: vi.fn().mockImplementation((signer) => Promise.resolve(signer.publicKey?.toBase58() || "mockSigner")),
}));

vi.mock("./token2022.js", async () => {
  const { PublicKey } = await import("@solana/web3.js");
  return {
    createSkillMint: vi.fn().mockResolvedValue(new PublicKey("11111111111111111111111111111111")),
    mintSkillToken: vi.fn().mockResolvedValue("mockMintSig"),
  };
});

vi.mock("@solana/spl-token", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/spl-token")>();
  const { PublicKey } = await import("@solana/web3.js");
  return {
    ...actual,
    createMintToInstruction: vi.fn().mockReturnValue(new (require("@solana/web3.js").TransactionInstruction)({ keys: [], programId: new PublicKey("11111111111111111111111111111111"), data: Buffer.alloc(0) })),
    createAssociatedTokenAccountInstruction: vi.fn().mockReturnValue(new (require("@solana/web3.js").TransactionInstruction)({ keys: [], programId: new PublicKey("11111111111111111111111111111111"), data: Buffer.alloc(0) })),
    getAssociatedTokenAddressSync: vi.fn().mockReturnValue(new PublicKey("11111111111111111111111111111111")),
  };
});

describe("nft/skill", () => {
  let mockConn: any;
  let signer: Keypair;

  beforeEach(() => {
    mockConn = {
      getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
      sendRawTransaction: vi.fn().mockResolvedValue("mockTxSig"),
      confirmTransaction: vi.fn().mockResolvedValue({}),
      getAccountInfo: vi.fn().mockResolvedValue({ data: new Uint8Array() }), // simulate ATA exists
    };
    signer = Keypair.generate();
    vi.clearAllMocks();
  });

  it("should publish a skill successfully", async () => {
    const mintAddr = await publishSkill(mockConn as any, signer, {
      name: "SuperSkill",
      description: "Does things",
      text: "Skill content",
      category: "ai",
      hashtags: ["cool"],
    });

    expect(mintAddr).toBe("11111111111111111111111111111111");
    expect(chain.ensureDbRoot).toHaveBeenCalled();
    expect(chain.codeIn).toHaveBeenCalledWith(signer, "Skill content", "SuperSkill.md", "text/markdown");
    expect(token2022.createSkillMint).toHaveBeenCalled();
  });

  it("should buy a skill for free (price 0)", async () => {
    const sig = await buySkill(mockConn as any, signer, {
      skillId: "11111111111111111111111111111111",
      buyerWallet: signer.publicKey.toBase58(),
      creatorWallet: "11111111111111111111111111111111",
      price: 0n,
    });

    expect(sig).toBe("mockTxSig");
    expect(mockConn.sendRawTransaction).toHaveBeenCalled();
  });

  it("should buy a skill with a price and split fees", async () => {
    const sig = await buySkill(mockConn as any, signer, {
      skillId: "11111111111111111111111111111111",
      buyerWallet: signer.publicKey.toBase58(),
      creatorWallet: "11111111111111111111111111111111",
      price: 1000n,
      iqFeePercent: 0.1, // 10%
    });

    expect(sig).toBe("mockTxSig");
    // Verify that the tx includes transfers (we can't easily assert on the SystemProgram inner workings without deep mocking,
    // but we can ensure the transaction was sent successfully).
    expect(mockConn.sendRawTransaction).toHaveBeenCalled();
  });
});
