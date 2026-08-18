import { describe, it, expect, vi, afterEach } from "vitest";

const BIGINT_NOISE = "bigint: Failed to load bindings, pure JS will be used (try npm run rebuild?)";

// The module is a side-effect import (it must hook console.warn BEFORE the solana deps
// load), so each test stubs console.warn first, then imports a fresh copy.
describe("quietBigintWarning", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("swallows exactly the bigint-buffer load warning, once, then restores console.warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await import("./quietBigintWarning.js");

    console.warn(BIGINT_NOISE);
    expect(warn).not.toHaveBeenCalled(); // the noise line is dropped

    // the hook stepped out of the way: real warnings reach the original again
    expect(console.warn).toBe(warn);
    console.warn("a real warning");
    expect(warn).toHaveBeenCalledExactlyOnceWith("a real warning");
  });

  it("passes every other warning through while the hook is armed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await import("./quietBigintWarning.js");

    console.warn("something else entirely");
    console.warn("bigint: but a different message than the load warning?");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenNthCalledWith(1, "something else entirely");
  });
});
