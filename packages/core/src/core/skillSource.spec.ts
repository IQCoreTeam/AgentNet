import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dasSource, indexerSource, ownedAssetIds, ownedSkillMints, pluginManifestFromMetadata, traitsFromAttributes } from "./skillSource.js";
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
    delete process.env.AGENTNET_PLUGINS_COLLECTION_PUBKEY;
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

describe("core/skillSource — marketplace traits", () => {
  it("parses plugin tags, repeated engine badges, and IQ Git PDA", () => {
    const traits = traitsFromAttributes([
      { trait_type: "category", value: "developer-tools" },
      { trait_type: "plugin", value: "git" },
      { trait_type: "plugin", value: "review" },
      { trait_type: "engine", value: "claude" },
      { trait_type: "engine", value: "codex" },
      { trait_type: "iqGitPda", value: "IqGitPda111" },
    ]);

    expect(traits).toEqual({
      category: "developer-tools",
      hashtags: ["git", "review"],
      requiredSkills: [],
      engines: ["claude", "codex"],
      iqGitPda: "IqGitPda111",
    });
  });

  it("normalizes plugin manifest install coordinates", () => {
    expect(pluginManifestFromMetadata({
      pluginManifest: {
        id: "iq-git-reviewer",
        entrypoint: ".codex-plugin/plugin.json",
        codex: { pluginName: "iq-git-reviewer", marketplaceName: "personal" },
        claude: {
          marketplaceName: "iq-plugins",
          pluginName: "iq-git-reviewer",
          source: { source: "github", repo: "IQCoreTeam/agentnet-plugins", ref: "main" },
        },
      },
    })).toEqual({
      id: "iq-git-reviewer",
      entrypoint: ".codex-plugin/plugin.json",
      codex: {
        pluginName: "iq-git-reviewer",
        marketplaceName: "personal",
        marketplacePath: null,
        remoteMarketplaceName: null,
      },
      claude: {
        marketplaceName: "iq-plugins",
        pluginName: "iq-git-reviewer",
        source: { source: "github", repo: "IQCoreTeam/agentnet-plugins", ref: "main" },
      },
    });
  });
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

  it("maps plugin /items with engine badges and provenance fields", async () => {
    const src = indexerSource("https://nft-index.iqlabs.dev/");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            {
              mint: "pluginMint",
              type: "plugin",
              name: "iq-git-reviewer",
              description: "Review with IQ Git context.",
              creator: "alice",
              supply: 7,
              price: "0",
              version: "1.2.3",
              capabilities: ["git.read", "review.write"],
              permissions: ["fs.read"],
              pluginManifest: {
                id: "iq-git-reviewer",
                codex: { pluginName: "iq-git-reviewer", marketplaceName: "personal" },
                claude: { marketplaceName: "iq-plugins", pluginName: "iq-git-reviewer" },
              },
              attributes: [
                { trait_type: "category", value: "developer-tools" },
                { trait_type: "plugin", value: "git" },
                { trait_type: "engine", value: "claude" },
                { trait_type: "engine", value: "codex" },
                { trait_type: "iqGitPda", value: "IqGitPda111" },
              ],
            },
          ],
        }),
      }),
    );

    const items = await src.listSkills();
    expect(items[0]).toMatchObject({
      id: "pluginMint",
      type: "plugin",
      engines: ["claude", "codex"],
      iqGitPda: "IqGitPda111",
      version: "1.2.3",
      capabilities: ["git.read", "review.write"],
      permissions: ["fs.read"],
      pluginManifest: {
        id: "iq-git-reviewer",
        codex: {
          pluginName: "iq-git-reviewer",
          marketplaceName: "personal",
          marketplacePath: null,
          remoteMarketplaceName: null,
        },
        claude: {
          marketplaceName: "iq-plugins",
          pluginName: "iq-git-reviewer",
        },
      },
      hashtags: ["git"],
    });
  });

  it("throws on a non-ok indexer response (caller falls back to dasSource)", async () => {
    const src = indexerSource("https://nft-index.iqlabs.dev");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(src.listSkills()).rejects.toThrow(/HTTP 503/);
  });
});

// ownedSkillMints decides "which of our skills does this wallet hold". Holdings come from
// a STANDARD-RPC getTokenAccountsByOwner over the Token-2022 program (works on any node —
// no DAS tier needed). Holdings the catalog already lists are matched cheaply (no per-asset
// read — the fast path that avoids the old 429 fan-out); holdings the catalog MISSES (the
// indexer under-reports our Token-2022 group) fall through to an on-chain TokenGroupMember
// check against the current collections, bounded by that gap.
describe("core/skillSource — ownedAssetIds / ownedSkillMints", () => {
  const origEnv = { ...process.env };
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.DAS_RPC_URL = "https://das.example/rpc";
    process.env.AGENTNET_SKILLS_COLLECTION_PUBKEY = "SkillsCollection";
    delete process.env.AGENTNET_WORKFLOWS_COLLECTION_PUBKEY;
    delete process.env.AGENTNET_PLUGINS_COLLECTION_PUBKEY;
    process.env.AGENTNET_HOME = "/tmp/agentnet-owned-test";
  });
  afterEach(() => { process.env = { ...origEnv }; });

  // A parsed Token-2022 token-account entry as getTokenAccountsByOwner returns it.
  const tokenAcct = (mint: string, decimals: number, uiAmount: number) => ({
    account: { data: { parsed: { info: { mint, tokenAmount: { decimals, uiAmount } } } } },
  });

  it("ownedAssetIds returns held Token-2022 NFT mints (0-decimal, held≥1), skipping fungibles/empties", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ result: { value: [
        tokenAcct("m1", 0, 1),
        tokenAcct("m2", 0, 1),
        tokenAcct("fungible", 6, 100), // decimals > 0 → not an NFT → excluded
        tokenAcct("burned", 0, 0),     // none held → excluded
      ] } }),
    }));
    const ids = await ownedAssetIds("wallet");
    expect([...ids].sort()).toEqual(["m1", "m2"]);
  });

  it("fast path: holdings fully covered by the catalog need no on-chain per-asset read", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ result: { value: [ tokenAcct("m1", 0, 1) ] } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const catalog = [{ id: "m1" }, { id: "m2" }] as Skill[]; // m2 not held
    const owned = await ownedSkillMints("wallet", catalog);
    expect(owned).toEqual(["m1"]); // held ∩ catalog
    expect(fetchMock).toHaveBeenCalledTimes(1); // holdings query only — no gap, no group read
  });

  it("rescues a held mint the catalog misses when on-chain it belongs to a current collection", async () => {
    // The indexer catalog lists only m1, but the wallet also holds "gapMint" — a real
    // current-collection skill the indexer under-reported. It must still count as owned.
    const fetchMock = vi.fn().mockImplementation(async (_url: string, opts?: any) => {
      const method = opts?.body ? JSON.parse(opts.body).method : "";
      if (method === "getTokenAccountsByOwner") {
        return { json: async () => ({ result: { value: [
          tokenAcct("m1", 0, 1), tokenAcct("gapMint", 0, 1), tokenAcct("alienMint", 0, 1),
        ] } }) };
      }
      // getMultipleAccounts → one batched call; value[] is aligned to the requested
      // mints. TokenGroupMember.state.group is the on-chain ground truth.
      const mints: string[] = JSON.parse(opts.body).params[0];
      const value = mints.map((mint) => ({ data: { parsed: { info: { extensions: [
        { extension: "tokenGroupMember", state: { group: mint === "gapMint" ? "SkillsCollection" : "SomeOtherCollection" } },
      ] } } } }));
      return { json: async () => ({ result: { value } }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const catalog = [{ id: "m1" }] as Skill[];
    const owned = (await ownedSkillMints("wallet", catalog)).sort();
    expect(owned).toEqual(["gapMint", "m1"]); // m1 via catalog; gapMint rescued; alienMint excluded (wrong group)
    // gap rescue is ONE batched getMultipleAccounts, not a per-mint fan-out.
    const gmaCalls = fetchMock.mock.calls.filter((c: any) => JSON.parse(c[1].body).method === "getMultipleAccounts");
    expect(gmaCalls).toHaveLength(1);
  });

  it("self-fetches the catalog from the indexer when none is passed", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, opts?: any) => {
      const method = opts?.body ? JSON.parse(opts.body).method : "";
      if (method === "getTokenAccountsByOwner") {
        return { json: async () => ({ result: { value: [
          tokenAcct("m1", 0, 1),
          tokenAcct("held-but-not-a-skill", 0, 1),
        ] } }) };
      }
      if (method === "getMultipleAccounts") {
        // held-but-not-a-skill resolves to a foreign group → excluded.
        const mints: string[] = JSON.parse(opts.body).params[0];
        const value = mints.map(() => ({ data: { parsed: { info: { extensions: [
          { extension: "tokenGroupMember", state: { group: "SomeOtherCollection" } },
        ] } } } }));
        return { json: async () => ({ result: { value } }) };
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
