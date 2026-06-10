import { describe, it, expect } from "vitest";
import {
  AGENTNET_ROOT_ID,
  mysessionsHint,
  notesSkillHint,
  notesAgentHint,
  AUDIT_HINT,
  reputationHint,
} from "./seed.js";

describe("core/seed", () => {
  it("should have correct static constants", () => {
    expect(AGENTNET_ROOT_ID).toBe("agentnet-root");
    expect(AUDIT_HINT).toBe("audit:skills");
  });

  it("should format mysessionsHint correctly", () => {
    expect(mysessionsHint("11111111111111111111111111111111")).toBe(
      "mysessions:11111111111111111111111111111111"
    );
  });

  it("should format notesSkillHint correctly", () => {
    expect(notesSkillHint("SkillMint123")).toBe("notes:skill:SkillMint123");
  });

  it("should format notesAgentHint correctly", () => {
    expect(notesAgentHint("AgentWallet123")).toBe("notes:agent:AgentWallet123");
  });

  it("should format reputationHint correctly", () => {
    expect(reputationHint("AgentWallet123")).toBe("reputation:AgentWallet123");
  });
});
