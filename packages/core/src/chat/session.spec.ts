// Dispatcher regression: changing the permission mode (or model) while a session is
// live must NOT interrupt the in-flight turn. The old handler stopped the handle on
// the toggle (claude q.interrupt / codex child.kill), killing the turn the user was
// watching. The fix is lazy-restage: keep the running handle, re-spawn on the NEXT
// send carrying the live sessionId so the turn finishes and the new mode applies next.
import { describe, it, expect, vi } from "vitest";
import { createChatSession } from "./session.js";

function fakeHandle(id: string, cli: "claude" | "codex") {
  return {
    sessionId: id,
    cli,
    send: vi.fn(),
    onMessage: vi.fn(),
    onTurnEnd: vi.fn(),
    onSkill: vi.fn(),
    onUsage: vi.fn(),
    stop: vi.fn(),
  };
}

// let the dispatcher's async queue (pump → ensureHandle → startSession) drain
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

function harness() {
  const handles: ReturnType<typeof fakeHandle>[] = [];
  const startSession = vi.fn(async (opts: any) => {
    const h = fakeHandle("sess-" + handles.length, opts.cli);
    (h as any).opts = opts;
    handles.push(h);
    return h;
  });
  const recv: ((m: any) => void)[] = [];
  const transport = { send: vi.fn(), onRecv: (cb: (m: any) => void) => recv.push(cb) };
  const fromUI = (m: any) => recv.forEach((cb) => cb(m));
  const env: any = {
    cwd: () => "/tmp",
    approval: { onDecision: () => {}, request: async () => "deny" },
    walletAddress: () => null,
    storageInfo: async () => ({ info: {}, options: [] }),
  };
  const chat = createChatSession(startSessionRuntime(startSession), transport as any, env);
  return { handles, startSession, fromUI, chat, transport };
}

// minimal AgentRuntime: only startSession is exercised by send/mode handlers
function startSessionRuntime(startSession: any): any {
  return { startSession, listSessions: async () => [], loadSession: async () => ({ messages: [], hasMore: false, cursor: 0 }) };
}

describe("chat/session — permission mode never interrupts a live turn", () => {
  it("toggling mode keeps the running handle; next send re-spawns with the new mode + same session", async () => {
    const { handles, startSession, fromUI } = harness();

    // 1) first send spawns a handle on the default (claude/"default") slot
    fromUI({ type: "send", text: "hi" });
    await flush();
    expect(startSession).toHaveBeenCalledTimes(1);
    expect(handles).toHaveLength(1);
    // the claude slot's default mode (whatever it is) is carried on the first spawn
    const defaultMode = (handles[0] as any).opts.mode;
    expect(typeof defaultMode).toBe("string");
    expect(defaultMode).not.toBe("plan"); // not yet toggled
    expect(handles[0].send).toHaveBeenCalledWith("hi", undefined);

    // 2) THE REGRESSION: toggle mode mid-session. The live handle must NOT be stopped
    //    (old code called handle.stop() here → the turn the user is watching dies).
    fromUI({ type: "mode", mode: "plan" });
    await flush();
    expect(handles[0].stop).not.toHaveBeenCalled();
    expect(startSession).toHaveBeenCalledTimes(1); // no eager re-spawn

    // 3) next send re-spawns lazily: new mode applied, SAME session carried (continuity),
    //    and only now is the old handle retired.
    fromUI({ type: "send", text: "again" });
    await flush();
    expect(startSession).toHaveBeenCalledTimes(2);
    expect(handles[0].stop).toHaveBeenCalledTimes(1);
    expect((handles[1] as any).opts.mode).toBe("plan");
    expect((handles[1] as any).opts.sessionId).toBe("sess-0"); // resumed, not blank
    expect(handles[1].send).toHaveBeenCalledWith("again", undefined);
  });

  it("model change follows the same lazy-restage path (no mid-turn kill, session preserved)", async () => {
    const { handles, startSession, fromUI } = harness();

    fromUI({ type: "send", text: "one" });
    await flush();
    expect((handles[0] as any).opts.model).toBeUndefined();

    fromUI({ type: "model", model: "opus" });
    await flush();
    expect(handles[0].stop).not.toHaveBeenCalled();

    fromUI({ type: "send", text: "two" });
    await flush();
    expect(startSession).toHaveBeenCalledTimes(2);
    expect((handles[1] as any).opts.model).toBe("opus");
    expect((handles[1] as any).opts.sessionId).toBe("sess-0");
  });
});

describe("chat/session — image attachments pass through to the engine", () => {
  const img = { mime: "image/png", dataBase64: "AAAA", name: "a.png" };

  it("forwards attached images alongside the text", async () => {
    const { handles, fromUI } = harness();
    fromUI({ type: "send", text: "look", images: [img] });
    await flush();
    expect(handles[0].send).toHaveBeenCalledWith("look", [img]);
  });

  it("allows an image-only turn (empty text, images present)", async () => {
    const { handles, startSession, fromUI } = harness();
    fromUI({ type: "send", text: "", images: [img] });
    await flush();
    expect(startSession).toHaveBeenCalledTimes(1);
    expect(handles[0].send).toHaveBeenCalledWith("", [img]);
  });

  it("ignores a truly empty turn (no text, no images)", async () => {
    const { startSession, fromUI } = harness();
    fromUI({ type: "send", text: "", images: [] });
    await flush();
    expect(startSession).not.toHaveBeenCalled();
  });
});
