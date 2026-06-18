import { describe, it, expect, vi, beforeEach } from "vitest";
import { heldSkillMints, invalidateHeldMints } from "./holdings.js";
import * as skillSource from "../core/skillSource.js";

vi.mock("../core/skillSource.js", () => ({
  ownedAssetIds: vi.fn(),
}));

const W = "ownerWalletAAA";

describe("notes/holdings", () => {
  beforeEach(() => {
    invalidateHeldMints(); // clear the module cache between tests
    vi.clearAllMocks();
  });

  it("returns the held mint set from a single RPC read", async () => {
    vi.mocked(skillSource.ownedAssetIds).mockResolvedValue(new Set(["mintA", "mintB"]));

    const held = await heldSkillMints(W);

    expect([...held].sort()).toEqual(["mintA", "mintB"]);
    expect(skillSource.ownedAssetIds).toHaveBeenCalledTimes(1);
  });

  it("caches per owner — repeated gates do NOT re-hit RPC", async () => {
    vi.mocked(skillSource.ownedAssetIds).mockResolvedValue(new Set(["mintA"]));

    await heldSkillMints(W);
    await heldSkillMints(W);
    await heldSkillMints(W);

    expect(skillSource.ownedAssetIds).toHaveBeenCalledTimes(1); // one call covered all three
  });

  it("force bypasses the cache (e.g. after a buy)", async () => {
    vi.mocked(skillSource.ownedAssetIds).mockResolvedValue(new Set(["mintA"]));
    await heldSkillMints(W);
    await heldSkillMints(W, { force: true });
    expect(skillSource.ownedAssetIds).toHaveBeenCalledTimes(2);
  });

  it("invalidate forces a fresh read", async () => {
    vi.mocked(skillSource.ownedAssetIds).mockResolvedValue(new Set(["mintA"]));
    await heldSkillMints(W);
    invalidateHeldMints(W);
    await heldSkillMints(W);
    expect(skillSource.ownedAssetIds).toHaveBeenCalledTimes(2);
  });

  it("retries a transient RPC error before succeeding", async () => {
    vi.mocked(skillSource.ownedAssetIds)
      .mockRejectedValueOnce(new Error("429"))
      .mockResolvedValueOnce(new Set(["mintA"]));

    const held = await heldSkillMints(W);

    expect([...held]).toEqual(["mintA"]);
    expect(skillSource.ownedAssetIds).toHaveBeenCalledTimes(2);
  });

  it("does not trust a flaky empty read when a prior non-empty set exists", async () => {
    // First resolve a real set, then a flaky empty followed by the real set again.
    vi.mocked(skillSource.ownedAssetIds).mockResolvedValueOnce(new Set(["mintA"]));
    await heldSkillMints(W); // primes cache with {mintA}

    invalidateHeldMints(W); // expire TTL but keep last-good
    // re-prime last-good without clearing it: easier to assert via the empty-retry path
    vi.mocked(skillSource.ownedAssetIds)
      .mockResolvedValueOnce(new Set(["mintA"])) // cache again
      .mockResolvedValueOnce(new Set<string>()) // flaky empty
      .mockResolvedValueOnce(new Set(["mintA"])); // real on retry
    await heldSkillMints(W);
    const held = await heldSkillMints(W, { force: true });

    expect([...held]).toEqual(["mintA"]); // the empty read was retried away
  });

  it("falls back to the last good set when every retry fails", async () => {
    vi.mocked(skillSource.ownedAssetIds).mockResolvedValueOnce(new Set(["mintA"]));
    await heldSkillMints(W); // last-good = {mintA}

    vi.mocked(skillSource.ownedAssetIds).mockRejectedValue(new Error("down"));
    const held = await heldSkillMints(W, { force: true });

    expect([...held]).toEqual(["mintA"]); // reused last-good instead of throwing/empty
  });
});
