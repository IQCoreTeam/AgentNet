import { describe, it, expect, vi, beforeEach } from "vitest";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { publishSkill, buySkill } from "./skill.js";
import { ValidationError } from "./validation/index.js";
import type { ValidationAdapter } from "./validation/index.js";
import * as chain from "../core/chain.js";
import * as token2022 from "./token2022.js";

vi.mock("../core/chain.js", () => ({
  ensureDbRoot: vi.fn().mockResolvedValue("mockDbRootSig"),
  codeIn: vi.fn().mockResolvedValue("mockCodeInSig"),
  signerAddress: vi.fn().mockImplementation((signer) => Promise.resolve(signer.publicKey?.toBase58() || "mockSigner")),
  writeRow: vi.fn().mockResolvedValue("mockWriteRowSig"),
  ensureTable: vi.fn().mockResolvedValue(null),
}));

vi.mock("../core/seed.js", () => ({
  AUDIT_HINT: "audit:skills",
  AUDIT_COLUMNS: ["id", "name", "type", "supply", "createdAt"],
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

  // Use a valid SKILL.md that passes the default onchain validator
  const VALID_SKILL = `---
name: super-skill
description: A useful skill that teaches agents to reason step by step
category: ai
hashtags: [reasoning]
---

This skill teaches agents to reason clearly and break down complex problems.
`;

  it("should publish a skill successfully", async () => {
    const mintAddr = await publishSkill(mockConn as any, signer, {
      name: "super-skill",
      description: "A useful skill that teaches agents to reason step by step",
      text: VALID_SKILL,
      category: "ai",
      hashtags: ["reasoning"],
    });

    expect(mintAddr).toBe("11111111111111111111111111111111");
    expect(chain.ensureDbRoot).toHaveBeenCalled();
    expect(chain.codeIn).toHaveBeenCalledWith(signer, VALID_SKILL, "super-skill.md", "text/markdown");
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

  it("should throw ValidationError when default validator rejects", async () => {
    // Missing name and description — will fail compat check
    const invalidSkill = "Just some text with no frontmatter.";
    await expect(
      publishSkill(mockConn as any, signer, {
        name: "test",
        description: "test",
        text: invalidSkill,
      })
    ).rejects.toThrow(ValidationError);
    // Should NOT have called chain functions
    expect(chain.ensureDbRoot).not.toHaveBeenCalled();
  });

  it("should use a custom validator when provided", async () => {
    const alwaysPass: ValidationAdapter = {
      id: "always-pass",
      validate: async () => ({ ok: true, errors: [], warnings: [], infos: [] }),
    };
    // Even an invalid skill passes with a custom always-pass validator
    const mintAddr = await publishSkill(mockConn as any, signer, {
      name: "whatever",
      description: "whatever",
      text: "no frontmatter",
      validator: alwaysPass,
    });
    expect(mintAddr).toBe("11111111111111111111111111111111");
  });
});
