import { describe, it, expect, vi, beforeEach } from "vitest";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { createSkillMint, mintSkillToken } from "./token2022.js";
import * as splToken from "@solana/spl-token";

vi.mock("@solana/spl-token", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/spl-token")>();
  const { PublicKey } = await import("@solana/web3.js");
  return {
    ...actual,
    createInitializeMint2Instruction: vi.fn().mockReturnValue(new (require("@solana/web3.js").TransactionInstruction)({ keys: [], programId: new PublicKey("11111111111111111111111111111111"), data: Buffer.alloc(0) })),
    createInitializeNonTransferableMintInstruction: vi.fn().mockReturnValue(new (require("@solana/web3.js").TransactionInstruction)({ keys: [], programId: new PublicKey("11111111111111111111111111111111"), data: Buffer.alloc(0) })),
    createInitializeMetadataPointerInstruction: vi.fn().mockReturnValue(new (require("@solana/web3.js").TransactionInstruction)({ keys: [], programId: new PublicKey("11111111111111111111111111111111"), data: Buffer.alloc(0) })),
    createMintToInstruction: vi.fn().mockImplementation((_mint, _ata, authority) => new (require("@solana/web3.js").TransactionInstruction)({ keys: [{ pubkey: authority, isSigner: true, isWritable: false }], programId: new PublicKey("11111111111111111111111111111111"), data: Buffer.alloc(0) })),
    createAssociatedTokenAccountInstruction: vi.fn().mockReturnValue(new (require("@solana/web3.js").TransactionInstruction)({ keys: [], programId: new PublicKey("11111111111111111111111111111111"), data: Buffer.alloc(0) })),
    getAssociatedTokenAddressSync: vi.fn().mockReturnValue(new PublicKey("11111111111111111111111111111111")),
    getMintLen: vi.fn().mockReturnValue(170),
  };
});

describe("nft/token2022", () => {
  let mockConn: any;
  let signer: Keypair;

  beforeEach(() => {
    mockConn = {
      getMinimumBalanceForRentExemption: vi.fn().mockResolvedValue(1000000),
      getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 }),
      sendRawTransaction: vi.fn().mockResolvedValue("mockMintSig"),
      confirmTransaction: vi.fn().mockResolvedValue({}),
      getAccountInfo: vi.fn().mockResolvedValue(null), // simulate no ATA
    };
    signer = Keypair.generate();
    vi.clearAllMocks();
  });

  it("should create a skill mint and return its address", async () => {
    const mintPubkey = await createSkillMint(mockConn as any, signer, {
      name: "TestSkill",
      symbol: "TEST",
      uri: "mockTxId",
    });

    expect(mintPubkey).toBeInstanceOf(PublicKey);
    expect(mockConn.sendRawTransaction).toHaveBeenCalled();
    expect(splToken.createInitializeNonTransferableMintInstruction).toHaveBeenCalled();
  });

  it("should mint a skill token to the recipient", async () => {
    // Simulate ATA already exists
    mockConn.getAccountInfo.mockResolvedValueOnce({ data: new Uint8Array() });
    
    const sig = await mintSkillToken(mockConn as any, signer, "11111111111111111111111111111111", "11111111111111111111111111111111", Keypair.generate());

    expect(sig).toBe("mockMintSig");
    expect(splToken.createMintToInstruction).toHaveBeenCalled();
    // ATA creation should not be called since it exists
    expect(splToken.createAssociatedTokenAccountInstruction).not.toHaveBeenCalled();
  });

  it("should create ATA if it does not exist before minting", async () => {
    // getAccountInfo returns null for missing accounts (does not throw)
    mockConn.getAccountInfo.mockResolvedValueOnce(null);

    const sig = await mintSkillToken(mockConn as any, signer, "11111111111111111111111111111111", "11111111111111111111111111111111", Keypair.generate());

    expect(sig).toBe("mockMintSig");
    expect(splToken.createAssociatedTokenAccountInstruction).toHaveBeenCalled();
    expect(splToken.createMintToInstruction).toHaveBeenCalled();
  });
});
