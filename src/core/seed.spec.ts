import { describe, it, expect } from "vitest";
import {
  AGENTNET_ROOT_ID,
  mysessionsHint,
  reviewsHint,
  reviewsAgentHint,
  auditHint,
} from "./seed.js";

describe("core/seed", () => {
  it("should have correct static constants", () => {
    expect(AGENTNET_ROOT_ID).toBe("agentnet-root");
  });

  it("should format mysessionsHint correctly", () => {
    expect(mysessionsHint("11111111111111111111111111111111")).toBe(
      "mysessions:11111111111111111111111111111111"
    );
  });

  it("should format reviewsHint correctly (collection then item)", () => {
    expect(reviewsHint("SkillsCollection", "SkillMint123")).toBe(
      "reviews:SkillsCollection:SkillMint123"
    );
  });

  it("should format reviewsAgentHint correctly", () => {
    expect(reviewsAgentHint("AgentWallet123")).toBe("reviews:agent:AgentWallet123");
  });

  it("should format auditHint per collection", () => {
    expect(auditHint("SkillsCollection")).toBe("audit:SkillsCollection");
  });
});
