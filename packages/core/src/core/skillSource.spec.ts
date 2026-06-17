import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dasSource, indexerSource, ownedAssetIds, ownedSkillMints } from "./skillSource.js";
import type { Skill } from "./types.js";

// dasSource enumerates the TokenGroup collections via a DAS RPC. We mock fetch
// and the collection-mint config (env) to drive it without a real RPC.
describe("core/skillSource — dasSource", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.DAS_RPC_URL = "https://das.example/rpc";
    process.env.AGENTNET_SKILLS_COLLECTION_PUBKEY = "SkillsCollection";
    delete process.env.AGENTNET_WORKFLOWS_COLLECTION_PUBKEY;
    // isolate AGENTNET_HOME so resolveRpcUrl() can't read a real ~/.agentnet Helius key
    process.env.AGENTNET_HOME = "/tmp/agentnet-skillsource-test";
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("maps DAS items to Skill rows (id from item.id) + reads attributes", async () => {
    // The skills collection returns these items; the workflows collection (now a
    // default) returns none — so we only see the skill items.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url, opts: any) => {
        const body = JSON.parse(opts.body);
        const isSkills = body.params.groupValue === "SkillsCollection";
        return {
          json: async () => ({
            result: {
              items: isSkills
                ? [
                    {
                      id: "skill1",
                      content: {
                        metadata: {
                          name: "A",
                          // traits arrive in the scan (DAS resolves the uri JSON):
                          attributes: [
                            { trait_type: "category", value: "clean-code" },
                            { trait_type: "skill", value: "testing" },
                          ],
                        },
                      },
                      authorities: [{ address: "w1" }],
                    },
                    { id: "skill2", content: { metadata: {} } },
                  ]
                : [],
            },
          }),
        };
      }),
    );

    const skills = await dasSource.listSkills();
    expect(skills.map((s) => s.id)).toEqual(["skill1", "skill2"]);
    expect(skills[0].type).toBe("skill");
    expect(skills[0].creator).toBe("w1");
    // category/hashtags now come from content.metadata.attributes, not blanked.
    expect(skills[0].category).toBe("clean-code");
    expect(skills[0].hashtags).toEqual(["testing"]);
    expect(dasSource.hydrated).toBeFalsy(); // dasSource does NOT carry live supply
  });

  it("throws on a DAS error instead of hiding it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ error: { code: -1, message: "nope" } }) }),
    );
    await expect(dasSource.listSkills()).rejects.toThrow(/DAS getAssetsByGroup failed/);
  });

  it("falls back to the public-devnet default when no RPC is configured (issue #23)", async () => {
    delete process.env.DAS_RPC_URL;
    delete process.env.SOLANA_RPC_URL;
    let calledUrl = "";
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      calledUrl = url;
      return { json: async () => ({ result: { items: [] } }) };
    }));
    // no throw — resolveRpcUrl() supplies the default (a Helius key would win if set)
    await expect(dasSource.listSkills()).resolves.toEqual([]);
    expect(calledUrl).toContain("devnet"); // the public-devnet default
  });

  // (No "no collection mints" test: seed.ts now ships default devnet collection
  // ids, so a collection is always configured unless explicitly overridden.)
});

describe("core/skillSource — indexerSource", () => {
  afterEach(() => vi.restoreAllMocks());

  it("maps /items to Skill rows with live supply + traits, hydrated:true", async () => {
    const src = indexerSource("https://nft-index.iqlabs.dev/");
    expect(src.hydrated).toBe(true);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        expect(url).toBe("https://nft-index.iqlabs.dev/items?limit=1000&sort=supply");
        return {
          ok: true,
          json: async () => ({
            items: [
              {
                mint: "m1",
                type: "skill",
                name: "clean-code-refactor",
                description: "d",
                creator: "alice",
                supply: 42, // live — must survive without any getMintSupply
                attributes: [
                  { trait_type: "category", value: "clean-code" },
                  { trait_type: "skill", value: "testing" },
                ],
              },
            ],
          }),
        };
      }),
    );

    const skills = await src.listSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: "m1",
      type: "skill",
      creator: "alice",
      supply: 42,
      category: "clean-code",
      hashtags: ["testing"],
    });
  });

  it("throws on a non-ok indexer response (caller falls back to dasSource)", async () => {
    const src = indexerSource("https://nft-index.iqlabs.dev");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(src.listSkills()).rejects.toThrow(/HTTP 503/);
  });
});

// ownedSkillMints decides "which of our skills does this wallet hold". Holdings that
// the catalog already lists are matched cheaply (one getAssetsByOwner, no per-asset
// read — the fast path that avoids the old 429 fan-out). Holdings the catalog MISSES
// (the indexer under-reports our Token-2022 group) fall through to an on-chain
// TokenGroupMember check against the current collections, bounded by that gap.
describe("core/skillSource — ownedAssetIds / ownedSkillMints", () => {
  const origEnv = { ...process.env };
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.DAS_RPC_URL = "https://das.example/rpc";
    process.env.AGENTNET_SKILLS_COLLECTION_PUBKEY = "SkillsCollection";
    delete process.env.AGENTNET_WORKFLOWS_COLLECTION_PUBKEY;
    process.env.AGENTNET_HOME = "/tmp/agentnet-owned-test";
  });
  afterEach(() => { process.env = { ...origEnv }; });

  it("ownedAssetIds returns only held assets that carry a collection grouping", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ result: { items: [
        { id: "m1", grouping: [{ group_key: "collection", group_value: "syntheticX" }] },
        { id: "m2", grouping: [{ group_key: "collection", group_value: "syntheticY" }] },
        { id: "plain", grouping: [] }, // no collection grouping → excluded
      ] } }),
    }));
    const ids = await ownedAssetIds("wallet");
    expect([...ids].sort()).toEqual(["m1", "m2"]);
  });

  it("fast path: holdings fully covered by the catalog need no on-chain per-asset read", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ result: { items: [
        { id: "m1", grouping: [{ group_key: "collection", group_value: "x" }] },
      ] } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const catalog = [{ id: "m1" }, { id: "m2" }] as Skill[]; // m2 not held
    const owned = await ownedSkillMints("wallet", catalog);
    expect(owned).toEqual(["m1"]); // held ∩ catalog
    expect(fetchMock).toHaveBeenCalledTimes(1); // owner query only — no gap, no getParsedAccountInfo
  });

  it("rescues a held mint the catalog misses when on-chain it belongs to a current collection", async () => {
    // The indexer catalog lists only m1, but the wallet also holds "gapMint" — a real
    // current-collection skill the indexer under-reported. It must still count as owned.
    const fetchMock = vi.fn().mockImplementation(async (_url: string, opts?: any) => {
      const method = opts?.body ? JSON.parse(opts.body).method : "";
      if (method === "getAssetsByOwner") {
        return { json: async () => ({ result: { items: [
          { id: "m1", grouping: [{ group_key: "collection", group_value: "synthetic" }] },
          { id: "gapMint", grouping: [{ group_key: "collection", group_value: "synthetic" }] },
          { id: "alienMint", grouping: [{ group_key: "collection", group_value: "synthetic" }] },
        ] } }) };
      }
      // getParsedAccountInfo → TokenGroupMember.state.group is the on-chain ground truth.
      const mint = JSON.parse(opts.body).params[0];
      const group = mint === "gapMint" ? "SkillsCollection" : "SomeOtherCollection";
      return { json: async () => ({ result: { value: { data: { parsed: { info: { extensions: [
        { extension: "tokenGroupMember", state: { group } },
      ] } } } } } }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const catalog = [{ id: "m1" }] as Skill[];
    const owned = (await ownedSkillMints("wallet", catalog)).sort();
    expect(owned).toEqual(["gapMint", "m1"]); // m1 via catalog; gapMint rescued; alienMint excluded (wrong group)
  });

  it("self-fetches the catalog from the indexer when none is passed", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, opts?: any) => {
      const method = opts?.body ? JSON.parse(opts.body).method : "";
      if (method === "getAssetsByOwner") {
        return { json: async () => ({ result: { items: [
          { id: "m1", grouping: [{ group_key: "collection", group_value: "x" }] },
          { id: "held-but-not-a-skill", grouping: [{ group_key: "collection", group_value: "x" }] },
        ] } }) };
      }
      if (method === "getAccountInfo") {
        // held-but-not-a-skill resolves to a foreign group → excluded.
        return { json: async () => ({ result: { value: { data: { parsed: { info: { extensions: [
          { extension: "tokenGroupMember", state: { group: "SomeOtherCollection" } },
        ] } } } } } }) };
      }
      // indexer /items
      expect(url).toContain("/items");
      return { ok: true, json: async () => ({ items: [
        { mint: "m1", type: "skill", name: "n", description: "d", creator: "c", supply: 1, attributes: [] },
        { mint: "m9", type: "skill", name: "n", description: "d", creator: "c", supply: 1, attributes: [] },
      ] }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const owned = await ownedSkillMints("wallet");
    expect(owned).toEqual(["m1"]); // held m1 ∩ catalog{m1,m9}; held-but-not-a-skill excluded on-chain
  });
});
