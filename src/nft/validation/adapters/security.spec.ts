import { describe, it, expect, vi } from "vitest";
import { createSecurityLlmAdapter } from "./security.js";

const SKILL_TEXT = "This is a skill that helps agents plan tasks.";

describe("adapters/security — createSecurityLlmAdapter", () => {
  it("should pass when reviewFn returns safe: true", async () => {
    const reviewFn = vi.fn().mockResolvedValue({ safe: true });
    const adapter = createSecurityLlmAdapter(reviewFn);

    const r = await adapter.validate(SKILL_TEXT);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect(reviewFn).toHaveBeenCalledWith(SKILL_TEXT);
  });

  it("should error when reviewFn returns safe: false", async () => {
    const reviewFn = vi.fn().mockResolvedValue({
      safe: false,
      reason: "Contains prompt injection instructions",
    });
    const adapter = createSecurityLlmAdapter(reviewFn);

    const r = await adapter.validate(SKILL_TEXT);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.field === "content")).toBe(true);
    expect(r.errors[0].message).toContain("prompt injection");
  });

  it("should error with generic message when reason is not provided", async () => {
    const reviewFn = vi.fn().mockResolvedValue({ safe: false });
    const adapter = createSecurityLlmAdapter(reviewFn);

    const r = await adapter.validate(SKILL_TEXT);
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toContain("malicious");
  });

  it("should warn (not error) when reviewFn throws — fail-open", async () => {
    const reviewFn = vi.fn().mockRejectedValue(new Error("LLM service timeout"));
    const adapter = createSecurityLlmAdapter(reviewFn);

    const r = await adapter.validate(SKILL_TEXT);
    // Should NOT block publish on LLM outage
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect(r.warnings.some((w) => w.field === "content")).toBe(true);
    expect(r.warnings[0].message).toContain("LLM service timeout");
  });
});
