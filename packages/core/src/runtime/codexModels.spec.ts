import { describe, expect, it } from "vitest";
import { hasStaleModelsCacheSignal } from "./codexModels.js";

// The stale-cache signal is how surfaces learn "this codex is too old to see new
// models" (observed live: codex 0.137 logging `failed to load models cache: unknown
// variant 'max'` and silently falling back to its built-in 5.5-era list).
describe("hasStaleModelsCacheSignal", () => {
  it("flags the models-cache parse failure an outdated codex logs", () => {
    const stderr = [
      "2026-08-01T00:00:00.000Z WARN codex_core: failed to load models cache: unknown variant `max`, expected one of `minimal`, `low`, `medium`, `high`",
    ];
    expect(hasStaleModelsCacheSignal(stderr)).toBe(true);
  });

  it("stays quiet on a healthy probe", () => {
    expect(hasStaleModelsCacheSignal([])).toBe(false);
    expect(hasStaleModelsCacheSignal(["INFO codex app-server listening on stdio"])).toBe(false);
  });
});
