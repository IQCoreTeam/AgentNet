import { describe, it, expect } from "vitest";
import { buildItemJson } from "./skill.js";

// buildItemJson is the shared standard-NFT-JSON shape for BOTH publish paths. These
// tests pin the exact bytes each path used to produce independently, so the shared
// builder is a provable no-op refactor and the skill/workflow shapes can't drift.
describe("nft/buildItemJson — shared skill+workflow JSON shape", () => {
  it("skill shape: name/description/attributes/skillText, image omitted when absent", () => {
    const json = buildItemJson({
      name: "iq-onchain-db",
      description: "store data on solana",
      text: "# body",
      category: "solana",
      hashtags: ["solana", "iqlabs"],
    });
    // exactly what publishSkill's inline builder emitted before extraction
    expect(json).toBe(
      JSON.stringify({
        name: "iq-onchain-db",
        description: "store data on solana",
        attributes: [
          { trait_type: "category", value: "solana" },
          { trait_type: "skill", value: "solana" },
          { trait_type: "skill", value: "iqlabs" },
        ],
        skillText: "# body",
      }),
    );
    expect(json).not.toContain("image");
    expect(json).not.toContain("requiredSkill");
  });

  it("skill shape: image is included, in position, when present", () => {
    const json = buildItemJson({
      name: "s",
      description: "d",
      text: "b",
      image: "https://x.png",
    });
    expect(json).toBe(
      JSON.stringify({ name: "s", description: "d", image: "https://x.png", attributes: [], skillText: "b" }),
    );
  });

  it("workflow shape: requiredSkill traits appended after hashtags, no image", () => {
    const json = buildItemJson({
      name: "create-new-db",
      description: "creates a db",
      text: "# recipe",
      category: "developer",
      hashtags: ["solana"],
      requiredSkills: ["MintAAA", "MintBBB"],
    });
    // exactly what publishWorkflow's inline builder emitted before extraction
    expect(json).toBe(
      JSON.stringify({
        name: "create-new-db",
        description: "creates a db",
        attributes: [
          { trait_type: "category", value: "developer" },
          { trait_type: "skill", value: "solana" },
          { trait_type: "requiredSkill", value: "MintAAA" },
          { trait_type: "requiredSkill", value: "MintBBB" },
        ],
        skillText: "# recipe",
      }),
    );
  });

  it("a workflow always carries its description (regression: it must never be blank)", () => {
    const parsed = JSON.parse(
      buildItemJson({ name: "w", description: "real description", text: "steps", requiredSkills: ["M"] }),
    );
    expect(parsed.description).toBe("real description");
    expect(parsed.attributes).toContainEqual({ trait_type: "requiredSkill", value: "M" });
  });
});
