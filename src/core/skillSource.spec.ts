import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dasSource } from "./skillSource.js";

// dasSource enumerates the TokenGroup collections via a DAS RPC. We mock fetch
// and the collection-mint config (env) to drive it without a real RPC.
describe("core/skillSource — dasSource", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.DAS_RPC_URL = "https://das.example/rpc";
    process.env.AGENTNET_SKILLS_COLLECTION_PUBKEY = "SkillsCollection";
    delete process.env.AGENTNET_WORKFLOWS_COLLECTION_PUBKEY;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("maps DAS items to Skill rows (id from item.id)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({
          result: {
            items: [
              { id: "skill1", content: { metadata: { name: "A" } }, authorities: [{ address: "w1" }] },
              { id: "skill2", content: { metadata: {} } },
            ],
          },
        }),
      }),
    );

    const skills = await dasSource.listSkills();
    expect(skills.map((s) => s.id)).toEqual(["skill1", "skill2"]);
    expect(skills[0].type).toBe("skill");
    expect(skills[0].creator).toBe("w1");
  });

  it("throws on a DAS error instead of hiding it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ error: { code: -1, message: "nope" } }) }),
    );
    await expect(dasSource.listSkills()).rejects.toThrow(/DAS getAssetsByGroup failed/);
  });

  it("throws when no RPC is configured", async () => {
    delete process.env.DAS_RPC_URL;
    delete process.env.SOLANA_RPC_URL;
    await expect(dasSource.listSkills()).rejects.toThrow(/no DAS_RPC_URL/);
  });

  it("throws when no collection mints are configured", async () => {
    delete process.env.AGENTNET_SKILLS_COLLECTION_PUBKEY;
    delete process.env.AGENTNET_WORKFLOWS_COLLECTION_PUBKEY;
    await expect(dasSource.listSkills()).rejects.toThrow(/no collection mints/);
  });
});
