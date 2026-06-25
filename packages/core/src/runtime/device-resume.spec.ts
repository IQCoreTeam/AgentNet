import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime } from "./index.js";
import { manualStorage } from "../account/storage/manual.js";
import { testWallet } from "../account/keypairWallet.js";
import { SessionStore } from "../account/store.js";
import { buildDeviceNotice } from "../core/device.js";

// Mock spawnCli
const mockCliSend = vi.fn();
let mockCliOnSessionId: any = null;
let mockCliOnMessage: any = null;
let mockCliOnTurnEnd: any = null;

vi.mock("./spawn.js", () => {
  return {
    spawnCli: vi.fn((opts: any) => {
      return {
        send: mockCliSend,
        onSessionId: (cb: any) => {
          mockCliOnSessionId = cb;
          cb(opts.sessionId || "test-session-id");
        },
        onMessage: (cb: any) => { mockCliOnMessage = cb; },
        onSkill: () => {},
        onUsage: () => {},
        onCompact: () => {},
        onTurnEnd: (cb: any) => { mockCliOnTurnEnd = cb; },
        onError: () => {},
      };
    }),
  };
});

// Mock getDeviceProfile to return B by default
let currentDeviceProfile = { id: "device-B", label: "Device B" };
vi.mock("../core/device.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../core/device.js")>();
  return {
    ...original,
    getDeviceProfile: vi.fn(() => Promise.resolve(currentDeviceProfile)),
  };
});

describe("runtime/device-resume — cross-device notice resume flow", () => {
  let home: string;
  const origEnv = { ...process.env };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "agentnet-runtime-"));
    process.env.AGENTNET_HOME = home;
    mockCliSend.mockClear();
  });

  afterEach(() => {
    process.env = { ...origEnv };
    rmSync(home, { recursive: true, force: true });
  });

  it("injects cross-device notice on first send and updates page meta, but doesn't persist notice", async () => {
    const wallet = testWallet();
    const storage = manualStorage();
    const store = new SessionStore(wallet, storage);
    const sessionId = "test-session-123";

    // 1. Seed session with device-A
    await store.appendMessage(
      {
        sessionId,
        cli: "claude",
        title: "Hello World",
        ts: Date.now(),
        lastDevice: { id: "device-A", label: "Device A" },
      },
      {
        role: "user",
        text: "first user message",
        ts: Date.now(),
      }
    );

    // 2. Start session with device B (switch detected)
    const runtime = createRuntime(wallet, storage);
    const handle = await runtime.startSession({
      cli: "claude",
      cwd: "/some/dir",
      sessionId,
    });

    // 3. Verify newest page meta immediately updated to device B to guard against re-fire
    const loadedSessionAfterStart = await store.load(sessionId);
    expect(loadedSessionAfterStart?.lastDevice?.id).toBe("device-B");
    expect(loadedSessionAfterStart?.lastDevice?.label).toBe("Device B");

    // 4. Send message and verify notice prefix is sent to engine but NOT stored/emitted
    const emitMsgs: any[] = [];
    handle.onMessage((m) => {
      emitMsgs.push(m);
    });

    handle.send("second user message");
    await new Promise((r) => setTimeout(r, 50));

    // Check sent message to CLI has the notice prefix
    expect(mockCliSend).toHaveBeenCalledTimes(1);
    const noticeStr = buildDeviceNotice(
      { id: "device-A", label: "Device A" },
      { id: "device-B", label: "Device B" }
    );
    expect(mockCliSend.mock.calls[0][0]).toBe(noticeStr + "\n\nsecond user message");

    // Check emitted message lacks the notice prefix
    expect(emitMsgs).toHaveLength(1);
    expect(emitMsgs[0].text).toBe("second user message");

    // Check stored messages lacks notice prefix
    const loadedAfterSend = await store.load(sessionId);
    expect(loadedAfterSend?.messages).toHaveLength(2);
    expect(loadedAfterSend?.messages[1].text).toBe("second user message");

    // 5. Send another message and verify it does NOT carry the notice
    mockCliSend.mockClear();
    handle.send("third user message");

    expect(mockCliSend).toHaveBeenCalledTimes(1);
    expect(mockCliSend.mock.calls[0][0]).toBe("third user message");
  });

  it("does not inject notice on same-device resume", async () => {
    const wallet = testWallet();
    const storage = manualStorage();
    const store = new SessionStore(wallet, storage);
    const sessionId = "test-session-456";

    // 1. Seed session with device-B (same as current)
    await store.appendMessage(
      {
        sessionId,
        cli: "claude",
        title: "Hello World",
        ts: Date.now(),
        lastDevice: { id: "device-B", label: "Device B" },
      },
      {
        role: "user",
        text: "first user message",
        ts: Date.now(),
      }
    );

    // 2. Start session
    const runtime = createRuntime(wallet, storage);
    const handle = await runtime.startSession({
      cli: "claude",
      cwd: "/some/dir",
      sessionId,
    });

    // 3. Send message and verify NO notice prefix is sent
    handle.send("second user message");

    expect(mockCliSend).toHaveBeenCalledTimes(1);
    expect(mockCliSend.mock.calls[0][0]).toBe("second user message");
  });
});
