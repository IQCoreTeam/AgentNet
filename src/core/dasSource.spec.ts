import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dasSource } from "./skillSource.js";

const RPC = "DAS_RPC_URL";
const SOL = "SOLANA_RPC_URL";
const SKILLS = "AGENTNET_SKILLS_COLLECTION_PUBKEY";
const WORKFLOWS = "AGENTNET_WORKFLOWS_COLLECTION_PUBKEY";

function clearEnv() {
  for (const k of [RPC, SOL, SKILLS, WORKFLOWS]) delete process.env[k];
}

describe("core/dasSource", () => {
  beforeEach(clearEnv);
  afterEach(() => {
    clearEnv();
    vi.unstubAllGlobals();
  });

  it("throws (not silent fallback) when no RPC is configured", async () => {
    process.env[SKILLS] = "SkiLLCoLLecTion1111111111111111111111111111";
    await expect(dasSource.listSkills()).rejects.toThrow(/no DAS_RPC_URL/);
  });

  it("throws when no collection mint is configured", async () => {
    process.env[RPC] = "https://das.example";
    await expect(dasSource.listSkills()).rejects.toThrow(/no collection mints/);
  });

  it("builds a getAssetsByGroup(collection) request and parses items into Skill[]", async () => {
    process.env[RPC] = "https://das.example";
    process.env[SKILLS] = "SkiLLCoLLecTion1111111111111111111111111111";

    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        result: {
          items: [
            {
              id: "mintA",
              content: { metadata: { name: "alpha", description: "d" }, json_uri: "txid1" },
              authorities: [{ address: "creatorA" }],
            },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const skills = await dasSource.listSkills();

    // request shape
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.method).toBe("getAssetsByGroup");
    expect(body.params.groupKey).toBe("collection");
    expect(body.params.groupValue).toBe(process.env[SKILLS]);

    // parse shape
    expect(skills).toEqual([
      expect.objectContaining({
        id: "mintA",
        type: "skill",
        name: "alpha",
        description: "d",
        creator: "creatorA", // from authorities[0] (no Metaplex creators on Token-2022)
        uriTxid: "txid1",
        supply: 0,
      }),
    ]);
  });

  it("surfaces an RPC error instead of masking it with the table", async () => {
    process.env[RPC] = "https://das.example";
    process.env[SKILLS] = "SkiLLCoLLecTion1111111111111111111111111111";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ error: { code: -32601, message: "method not found" } }),
      }),
    );

    await expect(dasSource.listSkills()).rejects.toThrow(/getAssetsByGroup failed/);
  });

  it("returns an empty list visibly (not a table fallback) when DAS has no members", async () => {
    process.env[RPC] = "https://das.example";
    process.env[SKILLS] = "SkiLLCoLLecTion1111111111111111111111111111";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ result: { items: [] } }) }));

    await expect(dasSource.listSkills()).resolves.toEqual([]);
  });
});
