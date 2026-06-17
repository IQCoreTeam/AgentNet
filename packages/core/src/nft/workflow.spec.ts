import { describe, it, expect, vi, beforeEach } from "vitest";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { publishWorkflow, unlockWorkflow, sendTx } from "./workflow.js";
import { FormatError } from "./checkFormat.js";
import * as chain from "../core/chain.js";
import * as token2022 from "./token2022.js";

vi.mock("../core/chain.js", () => ({
  ensureDbRoot: vi.fn().mockResolvedValue("mockDbRootSig"),
  codeIn: vi.fn().mockResolvedValue("mockCodeInSig"),
  signerAddress: vi.fn().mockImplementation((signer) =>
    Promise.resolve(signer.publicKey?.toBase58() || "11111111111111111111111111111111"),
  ),
}));

vi.mock("../core/seed.js", () => ({
  // A collection is required now: the mint reserves member space and publish_item
  // enrolls it on-chain (PDA-signed), so this must be a real pubkey.
  getWorkflowsCollectionMint: vi.fn().mockReturnValue("F474VEn2uevpCotRqrPEbZ4XvWyqrqL4iGmNnmp9zvNe"),
  getWorkflowGateProgramId: vi.fn().mockReturnValue("3ptXj4yuaQG51WTA3SZZ37jGvYFgMhgXnSKWJLASJNkt"),
  getFeeTreasury: vi.fn().mockReturnValue("EWNSTD8tikwqHMcRNuuNbZrnYJUiJdKq9UXLXSEU4wZ1"),
}));

vi.mock("./token2022.js", async () => {
  const { PublicKey } = await import("@solana/web3.js");
  return {
    createSkillMint: vi.fn().mockResolvedValue(new PublicKey("11111111111111111111111111111111")),
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
      getAccountInfo: vi.fn().mockResolvedValue({ data: new Uint8Array() }), // ATA exists
    };
    signer = Keypair.generate();
    vi.clearAllMocks();
  });

  const VALID_WORKFLOW_MD = `---
name: test-workflow
description: This is a test workflow that chains skills
type: workflow
requiredSkills: [So11111111111111111111111111111111111111112]
category: ai
---

Workflow body here, long enough to pass the body length check easily.`;

  it("publishes a workflow (mint authority = gate PDA, then publish_workflow ix)", async () => {
    const mintAddr = await publishWorkflow(mockConn as any, signer, {
      name: "test-workflow",
      description: "This is a test workflow that chains skills",
      text: VALID_WORKFLOW_MD,
      requiredSkills: ["So11111111111111111111111111111111111111112"],
      category: "ai",
    });

    expect(typeof mintAddr).toBe("string");
    expect(chain.ensureDbRoot).toHaveBeenCalled();
    // code-in inscribes the standard NFT JSON: category + each requiredSkill as
    // a repeated trait (§4b), body in skillText.
    expect(chain.codeIn).toHaveBeenCalledWith(
      signer,
      expect.any(String),
      "test-workflow.json",
      "application/json",
    );
    const json = JSON.parse(vi.mocked(chain.codeIn).mock.calls[0][1] as string);
    expect(json.attributes).toEqual([
      { trait_type: "category", value: "ai" },
      { trait_type: "requiredSkill", value: "So11111111111111111111111111111111111111112" },
    ]);
    expect(json.skillText).toBe(VALID_WORKFLOW_MD);
    // createSkillMint is called with a pre-made mint keypair + a PDA mint
    // authority, and no traits (they live in the JSON now).
    const call = vi.mocked(token2022.createSkillMint).mock.calls[0][2] as any;
    expect(call.mintKeypair).toBeInstanceOf(Keypair);
    expect(call.minterAuthority).toBeInstanceOf(PublicKey);
    expect(call.category).toBeUndefined();
    // and the publish_workflow ix was sent.
    expect(mockConn.sendRawTransaction).toHaveBeenCalled();
  });

  it("rejects publish if the workflow MD is invalid (type not workflow)", async () => {
    const invalidMd = VALID_WORKFLOW_MD.replace("type: workflow", "type: skill");
    await expect(
      publishWorkflow(mockConn as any, signer, {
        name: "test-workflow",
        description: "This is a test workflow that chains skills",
        text: invalidMd,
        requiredSkills: ["So11111111111111111111111111111111111111112"],
        category: "ai",
      }),
    ).rejects.toThrow(FormatError);
  });

  it("unlock builds a buy_workflow tx (gate is on-chain — no client balance check)", async () => {
    const sig = await unlockWorkflow(mockConn as any, signer, {
      workflowId: "So11111111111111111111111111111111111111112",
      buyerWallet: signer.publicKey.toBase58(),
      creatorWallet: "11111111111111111111111111111111",
      requiredSkills: ["So11111111111111111111111111111111111111112"],
    });

    expect(sig).toBe("mockTxSig");
    expect(mockConn.sendRawTransaction).toHaveBeenCalled();
  });

  // Regression: a tx that LANDS but reverts is "confirmed" with a non-null
  // value.err. sendTx must throw on it — otherwise a reverted buy_item returns a
  // signature, the surface reports "Successfully purchased", and the soulbound
  // token is never minted (→ later "balance: 0" on the comment gate).
  it("sendTx throws (with logs) when a confirmed tx carries an execution error", async () => {
    mockConn.confirmTransaction.mockResolvedValueOnce({ value: { err: { InstructionError: [0, "Custom"] } } });
    mockConn.getTransaction = vi.fn().mockResolvedValue({
      meta: { err: { InstructionError: [0, "Custom"] }, logMessages: ["Program log: buy_item", "Program failed: insufficient funds"] },
    });

    const dummyIx = new TransactionInstruction({ programId: PublicKey.default, keys: [], data: Buffer.from([]) });
    await expect(sendTx(mockConn as any, signer, [dummyIx])).rejects.toThrow(/failed on-chain/);
    expect(mockConn.getTransaction).toHaveBeenCalled();
  });
});
