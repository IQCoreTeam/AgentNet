import { describe, it, expect, vi, beforeEach } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { publishSkill, buySkill } from "./skill.js";
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
  getSkillsCollectionMint: vi.fn().mockReturnValue(null),
  getWorkflowGateProgramId: vi.fn().mockReturnValue("3ptXj4yuaQG51WTA3SZZ37jGvYFgMhgXnSKWJLASJNkt"),
}));

vi.mock("./token2022.js", async () => {
  const { PublicKey } = await import("@solana/web3.js");
  return {
    createSkillMint: vi.fn().mockResolvedValue(new PublicKey("11111111111111111111111111111111")),
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
      getAccountInfo: vi.fn().mockResolvedValue({ data: new Uint8Array() }), // ATA exists
    };
    signer = Keypair.generate();
    vi.clearAllMocks();
  });

  const VALID_SKILL = `---
name: super-skill
description: A useful skill that teaches agents to reason step by step
category: ai
hashtags: [reasoning]
---

This skill teaches agents to reason clearly and break down complex problems.
`;

  it("publishes a skill (mint authority = gate PDA, then publish_item with no prereqs)", async () => {
    const mintAddr = await publishSkill(mockConn as any, signer, {
      name: "super-skill",
      description: "A useful skill that teaches agents to reason step by step",
      text: VALID_SKILL,
      category: "ai",
      hashtags: ["reasoning"],
    });

    expect(typeof mintAddr).toBe("string");
    expect(chain.ensureDbRoot).toHaveBeenCalled();
    expect(chain.codeIn).toHaveBeenCalledWith(signer, VALID_SKILL, "super-skill.md", "text/markdown");
    // createSkillMint gets a pre-made mint keypair + a PDA mint authority.
    const call = vi.mocked(token2022.createSkillMint).mock.calls[0][2] as any;
    expect(call.mintKeypair).toBeInstanceOf(Keypair);
    expect(call.minterAuthority).toBeInstanceOf(PublicKey);
    // and publish_item was sent.
    expect(mockConn.sendRawTransaction).toHaveBeenCalled();
  });

  it("buys a skill via buy_item (no client price/minter — gate is a no-op for skills)", async () => {
    const sig = await buySkill(mockConn as any, signer, {
      skillId: "So11111111111111111111111111111111111111112",
      buyerWallet: signer.publicKey.toBase58(),
      creatorWallet: "11111111111111111111111111111111",
    });

    expect(sig).toBe("mockTxSig");
    expect(mockConn.sendRawTransaction).toHaveBeenCalled();
  });

  it("throws FormatError when the format check rejects", async () => {
    await expect(
      publishSkill(mockConn as any, signer, {
        name: "test",
        description: "test",
        text: "Just some text with no frontmatter.",
      }),
    ).rejects.toThrow(FormatError);
    expect(chain.ensureDbRoot).not.toHaveBeenCalled();
  });
});
