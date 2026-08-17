import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime } from "./index.js";
import { manualStorage } from "../account/storage/manual.js";
import { testWallet } from "../account/keypairWallet.js";
import { SessionStore } from "../account/store.js";

// Mock spawnCli: no real engine ever runs. The fake reveals the passed sessionId
// (or a fixed fresh id) and lets sends complete silently.
vi.mock("./spawn.js", () => ({
  spawnCli: vi.fn((opts: any) => ({
    send: vi.fn(),
    onSessionId: (cb: any) => cb(opts.sessionId || "fresh-session-id"),
    onMessage: () => {},
    onSkill: () => {},
    onUsage: () => {},
    onCompact: () => {},
    onTurnEnd: () => {},
    onError: () => {},
  })),
}));

vi.mock("../core/device.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../core/device.js")>();
  return {
    ...original,
    getDeviceProfile: vi.fn(() => Promise.resolve({ id: "device-T", label: "Test" })),
  };
});

// Session model/effort fidelity (issue 167 round 2 finding 6): what a session runs with
// must be persisted in its meta, so a resume can restore it instead of silently falling
// back to the default model.
describe("runtime/session-settings: model/effort persist and survive resume", () => {
  let home: string;
  const origEnv = { ...process.env };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "agentnet-settings-"));
    process.env.AGENTNET_HOME = home;
    // keep the engines' own config dirs inside the sandbox too (memory/skills injects)
    process.env.CLAUDE_CONFIG_DIR = join(home, "claude");
    process.env.CODEX_HOME = join(home, "codex");
  });

  afterEach(() => {
    process.env = { ...origEnv };
    rmSync(home, { recursive: true, force: true });
  });

  it("a session started with a model/effort lists them back in a fresh process", async () => {
    const wallet = testWallet();
    const storage = manualStorage();
    const runtime = createRuntime(wallet, storage);

    const handle = await runtime.startSession({
      cli: "claude",
      cwd: home,
      model: "haiku",
      effort: "low",
    });
    handle.send("hello");
    await new Promise((r) => setTimeout(r, 50));

    // A FRESH store (new metaCache) = what a later `agentnet resume` boot sees.
    const metas = await new SessionStore(wallet, storage).listMine();
    expect(metas).toHaveLength(1);
    expect(metas[0].model).toBe("haiku");
    expect(metas[0].effort).toBe("low");
    expect(metas[0].cli).toBe("claude");
  });

  it("resuming under different settings refreshes the stored meta mid-page", async () => {
    const wallet = testWallet();
    const storage = manualStorage();

    const first = await createRuntime(wallet, storage).startSession({
      cli: "claude",
      cwd: home,
      model: "haiku",
      effort: "low",
    });
    first.send("first turn");
    await new Promise((r) => setTimeout(r, 50));

    // New process resumes the same session with an explicit different model.
    const second = await createRuntime(wallet, storage).startSession({
      cli: "claude",
      cwd: home,
      sessionId: "fresh-session-id",
      model: "sonnet",
      effort: "high",
    });
    second.send("second turn");
    await new Promise((r) => setTimeout(r, 50));

    const metas = await new SessionStore(wallet, storage).listMine();
    expect(metas).toHaveLength(1);
    expect(metas[0].model).toBe("sonnet");
    expect(metas[0].effort).toBe("high");
  });

  it("sessions saved before the fields existed list with no model/effort", async () => {
    const wallet = testWallet();
    const storage = manualStorage();
    const store = new SessionStore(wallet, storage);
    // Old-format meta: no model/effort keys were ever written.
    await store.appendMessage(
      { sessionId: "old-session", cli: "claude", title: "old", ts: Date.now() },
      { role: "user", text: "hi", ts: Date.now() },
    );

    const metas = await new SessionStore(wallet, storage).listMine();
    expect(metas).toHaveLength(1);
    expect(metas[0].model).toBeUndefined();
    expect(metas[0].effort).toBeUndefined();
  });

  it("a fork wakes up wearing the source session's settings", async () => {
    const wallet = testWallet();
    const storage = manualStorage();
    const runtime = createRuntime(wallet, storage);

    const handle = await runtime.startSession({
      cli: "claude",
      cwd: home,
      model: "haiku",
      effort: "xhigh",
    });
    handle.send("branch me");
    await new Promise((r) => setTimeout(r, 50));

    const forked = await runtime.forkSession("fresh-session-id");
    expect(forked.model).toBe("haiku");
    expect(forked.effort).toBe("xhigh");
  });
});
