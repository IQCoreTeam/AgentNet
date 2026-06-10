import { describe, it, expect, vi, beforeEach } from "vitest";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { publishWorkflow, unlockWorkflow, PrerequisiteError } from "./workflow.js";
import { ValidationError } from "./validation/index.js";
import * as chain from "../core/chain.js";
import * as token2022 from "./token2022.js";
import * as balance from "../notes/balance.js";

vi.mock("../core/chain.js", () => ({
  ensureDbRoot: vi.fn().mockResolvedValue("mockDbRootSig"),
  codeIn: vi.fn().mockResolvedValue("mockCodeInSig"),
  signerAddress: vi.fn().mockImplementation((signer) => Promise.resolve(signer.publicKey?.toBase58() || "mockSigner")),
  writeRow: vi.fn().mockResolvedValue("mockWriteRowSig"),
  ensureTable: vi.fn().mockResolvedValue(null),
}));

vi.mock("../core/seed.js", () => ({
  SKILLS_INDEX_HINT: "skills:index",
  SKILLS_INDEX_COLUMNS: ["id", "name", "type", "supply", "createdAt"],
}));

vi.mock("./token2022.js", async () => {
  const { PublicKey } = await import("@solana/web3.js");
  return {
    createSkillMint: vi.fn().mockResolvedValue(new PublicKey("11111111111111111111111111111111")),
    mintSkillToken: vi.fn().mockResolvedValue("mockMintSig"),
  };
});

vi.mock("../notes/balance.js", () => ({
  getBalance: vi.fn(),
}));

vi.mock("@solana/spl-token", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/spl-token")>();
  const { PublicKey } = await import("@solana/web3.js");
  return {
    ...actual,
    createMintToInstruction: vi.fn().mockImplementation((_mint, _ata, authority) => new (require("@solana/web3.js").TransactionInstruction)({ keys: [{ pubkey: authority, isSigner: true, isWritable: false }], programId: new PublicKey("11111111111111111111111111111111"), data: Buffer.alloc(0) })),
    createAssociatedTokenAccountInstruction: vi.fn().mockReturnValue(new (require("@solana/web3.js").TransactionInstruction)({ keys: [], programId: new PublicKey("11111111111111111111111111111111"), data: Buffer.alloc(0) })),
    getAssociatedTokenAddressSync: vi.fn().mockReturnValue(new PublicKey("11111111111111111111111111111111")),
  };
});

describe("nft/workflow", () => {
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

  const VALID_WORKFLOW_MD = `---
name: test-workflow
description: This is a test workflow
type: workflow
requiredSkills: [11111111111111111111111111111111]
category: ai
---

Workflow body here.`;

  it("should publish a workflow successfully", async () => {
    const mintAddr = await publishWorkflow(mockConn as any, signer, {
      name: "test-workflow",
      description: "This is a test workflow",
      text: VALID_WORKFLOW_MD,
      requiredSkills: ["11111111111111111111111111111111"],
      category: "ai",
    });

    expect(mintAddr).toBe("11111111111111111111111111111111");
    expect(chain.ensureDbRoot).toHaveBeenCalled();
    expect(chain.codeIn).toHaveBeenCalledWith(signer, VALID_WORKFLOW_MD, "test-workflow.md", "text/markdown");
    expect(token2022.createSkillMint).toHaveBeenCalled();
  });

  it("should reject publish if workflow MD is invalid", async () => {
    const invalidMd = VALID_WORKFLOW_MD.replace("type: workflow", "type: skill"); // invalid type
    await expect(
      publishWorkflow(mockConn as any, signer, {
        name: "test-workflow",
        description: "This is a test workflow",
        text: invalidMd,
        requiredSkills: ["11111111111111111111111111111111"],
        category: "ai",
      })
    ).rejects.toThrow(ValidationError);
  });

  it("should unlock a workflow successfully if prerequisite is met", async () => {
    vi.mocked(balance.getBalance).mockResolvedValue(1n);

    const sig = await unlockWorkflow(mockConn as any, signer, {
      workflowId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPvZeJ",
      buyerWallet: signer.publicKey.toBase58(),
      creatorWallet: "11111111111111111111111111111111",
      requiredSkills: ["11111111111111111111111111111111"],
      price: 100n,
      minter: Keypair.generate(), // protocol minter co-signs the mintTo (Path A)
    });

    expect(sig).toBe("mockTxSig");
    expect(balance.getBalance).toHaveBeenCalledTimes(1);
    expect(mockConn.sendRawTransaction).toHaveBeenCalled();
  });

  it("should throw PrerequisiteError if wallet is missing a required skill", async () => {
    vi.mocked(balance.getBalance).mockResolvedValue(0n); // wallet doesn't have the token

    await expect(
      unlockWorkflow(mockConn as any, signer, {
        workflowId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPvZeJ",
        buyerWallet: signer.publicKey.toBase58(),
        creatorWallet: "11111111111111111111111111111111",
        requiredSkills: ["11111111111111111111111111111111"],
        price: 100n,
      })
    ).rejects.toThrow(PrerequisiteError);

    expect(mockConn.sendRawTransaction).not.toHaveBeenCalled();
  });
});
