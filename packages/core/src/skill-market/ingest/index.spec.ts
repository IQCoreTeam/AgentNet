import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SkillSync } from "./index.js";

// installBoughtAllRetry is the best-effort race fix: a just-bought mint's metadata can lag
// the tx by a beat, so the install is retried a few times a short backoff apart. These
// tests stub installBoughtAll (the direct-mint install it wraps) and use fake timers so the
// backoff delays don't slow the suite.
describe("SkillSync.installBoughtAllRetry", () => {
  const conn = {} as any;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries and eventually returns the slug once an attempt succeeds", async () => {
    const sync = new SkillSync(conn);
    const spy = vi
      .spyOn(sync, "installBoughtAll")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("my-slug");

    const p = sync.installBoughtAllRetry("mint");
    await vi.runAllTimersAsync();

    await expect(p).resolves.toBe("my-slug");
    // (2) at most `attempts` calls — here it lands on the 3rd of 3.
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("makes at most `attempts` calls on a total miss", async () => {
    const sync = new SkillSync(conn);
    const spy = vi.spyOn(sync, "installBoughtAll").mockResolvedValue(null);

    const p = sync.installBoughtAllRetry("mint");
    await vi.runAllTimersAsync();

    await expect(p).resolves.toBeNull();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("resolves to null WITHOUT throwing when installBoughtAll always rejects (best-effort contract)", async () => {
    const sync = new SkillSync(conn);
    vi.spyOn(sync, "installBoughtAll").mockRejectedValue(new Error("boom"));

    const p = sync.installBoughtAllRetry("mint");
    await vi.runAllTimersAsync();

    await expect(p).resolves.toBeNull();
  });
});
