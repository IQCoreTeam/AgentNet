import { describe, it, expect, vi, beforeEach } from "vitest";
import { readSkillText } from "./token2022.js";
import * as chain from "../core/chain.js";
import * as splToken from "@solana/spl-token";

// readSkillText joins readSkillMintMetadata (getTokenMetadata) → readCodeIn.
vi.mock("../core/chain.js", () => ({
  signerAddress: vi.fn(),
  readCodeIn: vi.fn(),
}));

vi.mock("./minter.js", () => ({
  resolveMinter: vi.fn(),
  tryMinterPubkey: vi.fn(),
}));

vi.mock("@solana/spl-token", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/spl-token")>();
  return { ...actual, getTokenMetadata: vi.fn() };
});

const MINT = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPvZeJ";

describe("nft/readSkillText", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves mint → uri (txid) → skillText in the code-in JSON", async () => {
    vi.mocked(splToken.getTokenMetadata).mockResolvedValue({
      name: "my-skill",
      symbol: "MY",
      uri: "txid123",
      additionalMetadata: [],
    } as any);
    // The inscription is the standard NFT JSON; the body is its skillText field.
    vi.mocked(chain.readCodeIn).mockResolvedValue({
      data: JSON.stringify({
        name: "my-skill",
        description: "d",
        attributes: [{ trait_type: "category", value: "ai" }],
        skillText: "# SKILL body text",
      }),
      metadata: "",
    });

    const text = await readSkillText({} as any, MINT);

    expect(text).toBe("# SKILL body text");
    // the uri recovered from the mint is what readCodeIn is asked for
    expect(chain.readCodeIn).toHaveBeenCalledWith("txid123");
  });

  it("returns null when the mint has no metadata", async () => {
    vi.mocked(splToken.getTokenMetadata).mockResolvedValue(null as any);

    const text = await readSkillText({} as any, MINT);

    expect(text).toBeNull();
    expect(chain.readCodeIn).not.toHaveBeenCalled();
  });
});
