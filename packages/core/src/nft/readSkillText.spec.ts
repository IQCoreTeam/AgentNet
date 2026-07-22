import { describe, it, expect, vi, beforeEach } from "vitest";
import { readSkillText } from "./token2022.js";
import * as chain from "../core/chain.js";
import * as splToken from "@solana/spl-token";

// readSkillText joins readSkillMintMetadata (getTokenMetadata) → readCodeIn.
// Keep the real inscriptionSigOf: the uri→sig extraction IS part of the path
// under test (legacy bare-sig uris and gateway-URL uris must both resolve).
vi.mock("../core/chain.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../core/chain.js")>();
  return { ...actual, signerAddress: vi.fn(), readCodeIn: vi.fn() };
});

vi.mock("./minter.js", () => ({
  resolveMinter: vi.fn(),
  tryMinterPubkey: vi.fn(),
}));

vi.mock("@solana/spl-token", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/spl-token")>();
  return { ...actual, getTokenMetadata: vi.fn() };
});

const MINT = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPvZeJ";
// A realistically-shaped inscription signature (64 raw bytes → 87-88 base58).
const TXID = "4K3z7cWH8QAxd74tK4ErtNv8ZL1k97yrAsm7SQJg4zPRya7DnbsxtmZwEgza4H34Z6QX9ewjqpmospXe3KQahruh";

const SKILL_JSON = JSON.stringify({
  name: "my-skill",
  description: "d",
  attributes: [{ trait_type: "category", value: "ai" }],
  skillText: "# SKILL body text",
});

describe("nft/readSkillText", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves mint → legacy bare-sig uri → skillText in the code-in JSON", async () => {
    vi.mocked(splToken.getTokenMetadata).mockResolvedValue({
      name: "my-skill",
      symbol: "MY",
      uri: TXID,
      additionalMetadata: [],
    } as any);
    // The inscription is the standard NFT JSON; the body is its skillText field.
    vi.mocked(chain.readCodeIn).mockResolvedValue({ data: SKILL_JSON, metadata: "" });

    const text = await readSkillText({} as any, MINT);

    expect(text).toBe("# SKILL body text");
    // the sig recovered from the mint uri is what readCodeIn is asked for
    expect(chain.readCodeIn).toHaveBeenCalledWith(TXID);
  });

  it("resolves a gateway-URL uri by extracting the sig from its last segment", async () => {
    vi.mocked(splToken.getTokenMetadata).mockResolvedValue({
      name: "my-skill",
      symbol: "MY",
      uri: `https://gateway.iqlabs.dev/skill/${MINT}/${TXID}`,
      additionalMetadata: [],
    } as any);
    vi.mocked(chain.readCodeIn).mockResolvedValue({ data: SKILL_JSON, metadata: "" });

    const text = await readSkillText({} as any, MINT);

    expect(text).toBe("# SKILL body text");
    expect(chain.readCodeIn).toHaveBeenCalledWith(TXID);
  });

  it("returns null (no on-chain read) when the uri carries no recognisable sig", async () => {
    vi.mocked(splToken.getTokenMetadata).mockResolvedValue({
      name: "my-skill",
      symbol: "MY",
      uri: "txid123",
      additionalMetadata: [],
    } as any);

    const text = await readSkillText({} as any, MINT);

    expect(text).toBeNull();
    expect(chain.readCodeIn).not.toHaveBeenCalled();
  });

  it("returns null when the mint has no metadata", async () => {
    vi.mocked(splToken.getTokenMetadata).mockResolvedValue(null as any);

    const text = await readSkillText({} as any, MINT);

    expect(text).toBeNull();
    expect(chain.readCodeIn).not.toHaveBeenCalled();
  });
});
