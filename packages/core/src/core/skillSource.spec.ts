import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dasSource, indexerSource } from "./skillSource.js";

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
