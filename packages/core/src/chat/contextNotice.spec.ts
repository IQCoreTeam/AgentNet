import { expect, it } from "vitest";
import { contextNotice } from "./contextNotice.js";

it("uses supplied capacity without inventing a model limit or compaction policy", () => {
  expect(contextNotice("claude", 10000, 100000)).toContain("10,000 / 100,000 (10%)");
  expect(contextNotice("codex")).toBe("Context (codex): usage not reported yet. Model context limit unknown.");
  expect(contextNotice("claude", 10000)).toContain("10,000 tokens last reported");
  expect(contextNotice("claude", 10000, 100000)).not.toContain("auto-compact");
});
it("Custom never presents a Codex fallback as provider capacity", () => {
  expect(contextNotice("custom", 12000, 256000)).toBe("Context (custom): 12,000 tokens last reported. Model context limit unknown.");
  expect(contextNotice("custom")).toContain("usage not reported yet");
});
