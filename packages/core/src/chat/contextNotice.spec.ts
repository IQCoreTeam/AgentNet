import { expect, it } from "vitest";
import { contextNotice } from "./contextNotice.js";

it("retains the standard engine breakdown and supplied window", () => {
  expect(contextNotice("claude", 10000, 100000)).toContain("10,000 / 100,000 (10%)");
  expect(contextNotice("codex")).toContain("256,000");
});
it("Custom never presents a Codex fallback as provider capacity", () => {
  expect(contextNotice("custom", 12000, 256000)).toBe("Context (custom): 12,000 tokens used. Provider context limit unknown.");
  expect(contextNotice("custom")).toContain("usage not reported yet");
});
