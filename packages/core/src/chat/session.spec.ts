// Dispatcher regression: changing the permission mode (or model) while a session is
// live must NOT interrupt the in-flight turn. The old handler stopped the handle on
// the toggle (claude q.interrupt / codex child.kill), killing the turn the user was
// watching. The fix is lazy-restage: keep the running handle, re-spawn on the NEXT
// send carrying the live sessionId so the turn finishes and the new mode applies next.
import { describe, it, expect, vi } from "vitest";
import { createChatSession } from "./session.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

function fakeHandle(id: string, cli: "claude" | "codex") {
  const usageCbs: Array<(n: number, window?: number) => void> = [];
  const compactCbs: Array<() => void> = [];
  const msgCbs: Array<(msg: any) => void> = [];
  const turnCbs: Array<() => void> = [];
  return {
    sessionId: id,
    cli,
    send: vi.fn(),
    runSlashCommand: vi.fn(),
    onMessage: vi.fn((cb: (msg: any) => void) => msgCbs.push(cb)),
    emitMessage: (msg: any) => msgCbs.forEach((cb) => cb(msg)),
    onTurnEnd: vi.fn((cb: () => void) => turnCbs.push(cb)),
    emitTurnEnd: () => turnCbs.forEach((cb) => cb()),
    onSkill: vi.fn(),
    onUsage: vi.fn((cb: (n: number, window?: number) => void) => usageCbs.push(cb)),
    emitUsage: (n: number, window?: number) => usageCbs.forEach((cb) => cb(n, window)),
    onCompact: vi.fn((cb: () => void) => compactCbs.push(cb)),
    emitCompact: () => compactCbs.forEach((cb) => cb()),
    interrupt: vi.fn(),
    stop: vi.fn(),
  };
}

// let the dispatcher's async queue (pump → ensureHandle → startSession) drain
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

// Wait for a specific notice to be sent. `/init` does real fs writes before sending the
// notice, so the notice is the completion signal — polling for it is deterministic where a
// fixed microtask flush races the fs IO under full-suite load. Throws if it never arrives.
const waitForNotice = async (transport: any, text: string) => {
  for (let i = 0; i < 200; i++) {
    if (transport.send.mock.calls.some((c: any[]) => c[0]?.type === "notice" && c[0]?.text === text)) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error(`notice "${text}" was never sent`);
};

function harness(opts: { cwd?: string; ownedSkills?: string[] } = {}) {
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
    cwd: () => opts.cwd ?? "/tmp",
    approval: { onDecision: () => {}, request: async () => "deny" },
    walletAddress: () => null,
    storageInfo: async () => ({ info: {}, options: [] }),
    ownedSkills: opts.ownedSkills ? async () => opts.ownedSkills : undefined,
  };
  const chat = createChatSession(startSessionRuntime(startSession), transport as any, env);
  return { handles, startSession, fromUI, chat, transport };
}

// minimal AgentRuntime: only startSession is exercised by send/mode handlers
function startSessionRuntime(startSession: any): any {
  return {
    startSession,
    listSessions: async () => [],
    loadSession: async () => ({ messages: [], hasMore: false, cursor: 0 }),
    loadSessionLocal: async () => ({ messages: [], hasMore: false, cursor: 0 }),
  };
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

describe("chat/session — switching sessions does not kill the original in-flight handle", () => {
  it("parks the active same-CLI session instead of stopping it when another session opens", async () => {
    const { handles, startSession, fromUI, transport } = harness();

    fromUI({ type: "send", text: "first" });
    await flush();
    expect(startSession).toHaveBeenCalledTimes(1);

    fromUI({ type: "new" });
    await flush();
    expect(handles[0].stop).not.toHaveBeenCalled();
    expect(startSession).toHaveBeenCalledTimes(1);

    fromUI({ type: "send", text: "second" });
    await flush();
    expect(startSession).toHaveBeenCalledTimes(2);
    expect(handles[1].send).toHaveBeenCalledWith("second", undefined);

    handles[0].emitMessage({ role: "assistant", text: "hidden", ts: 1, cli: "claude" });
    expect(transport.send).not.toHaveBeenCalledWith({
      type: "message",
      msg: { role: "assistant", text: "hidden", ts: 1, cli: "claude" },
    });
  });

  it("reuses the parked handle when the original session is reopened", async () => {
    const { handles, startSession, fromUI } = harness();

    fromUI({ type: "send", text: "first" });
    await flush();
    expect(handles[0].sessionId).toBe("sess-0");

    fromUI({ type: "new" });
    await flush();
    fromUI({ type: "send", text: "second" });
    await flush();
    expect(startSession).toHaveBeenCalledTimes(2);

    fromUI({ type: "open", sessionId: "sess-0" });
    await flush();
    fromUI({ type: "send", text: "resume" });
    await flush();

    expect(startSession).toHaveBeenCalledTimes(2);
    expect(handles[0].stop).not.toHaveBeenCalled();
    expect(handles[0].send).toHaveBeenNthCalledWith(2, "resume", undefined);
  });
});

describe("chat/session — switch-away frees idle sessions, keeps working ones until their turn ends", () => {
  it("stops an IDLE session (turn already ended) when another session opens", async () => {
    const { handles, fromUI } = harness();

    fromUI({ type: "send", text: "first" });
    await flush();
    handles[0].emitTurnEnd(); // turn finished → session is now idle
    await flush();

    fromUI({ type: "new" }); // switch away from an idle session
    await flush();
    expect(handles[0].stop).toHaveBeenCalledTimes(1); // freed, not kept alive
  });

  it("keeps a working session alive on switch-away, then retires it the moment its turn ends", async () => {
    const { handles, fromUI } = harness();

    fromUI({ type: "send", text: "first" });
    await flush(); // turn in flight (no turnEnd yet)

    fromUI({ type: "new" }); // switch away mid-turn
    await flush();
    expect(handles[0].stop).not.toHaveBeenCalled(); // not killed mid-turn

    handles[0].emitTurnEnd(); // the backgrounded turn finishes
    await flush();
    expect(handles[0].stop).toHaveBeenCalledTimes(1); // retired now that it's idle
  });

  it("an approval-blocked turn (no turnEnd) stays alive across a switch-away", async () => {
    const { handles, fromUI } = harness();

    fromUI({ type: "send", text: "needs approval" });
    await flush(); // turn blocked awaiting the user → onTurnEnd never fires

    fromUI({ type: "new" });
    await flush();
    fromUI({ type: "open", sessionId: "sess-0" }); // come back while still pending
    await flush();
    expect(handles[0].stop).not.toHaveBeenCalled(); // kept on the whole time
  });

  it("cancels retirement if you switch back before the background turn ends", async () => {
    const { handles, startSession, fromUI } = harness();

    fromUI({ type: "send", text: "first" });
    await flush();
    fromUI({ type: "new" }); // park + flag for retirement
    await flush();
    fromUI({ type: "open", sessionId: "sess-0" }); // switch back before the turn ends
    await flush();

    handles[0].emitTurnEnd(); // turn finally ends — but it's the active session again
    await flush();
    expect(handles[0].stop).not.toHaveBeenCalled(); // not retired (re-activated)

    fromUI({ type: "send", text: "again" });
    await flush();
    expect(startSession).toHaveBeenCalledTimes(1); // reused the live handle, no respawn
    expect(handles[0].send).toHaveBeenNthCalledWith(2, "again", undefined);
  });

  it("lazy-resumes a stopped idle session from storage when it is reopened", async () => {
    const { handles, startSession, fromUI } = harness();

    fromUI({ type: "send", text: "first" });
    await flush();
    handles[0].emitTurnEnd(); // idle
    await flush();
    fromUI({ type: "new" }); // idle → stopped
    await flush();
    expect(handles[0].stop).toHaveBeenCalledTimes(1);

    fromUI({ type: "send", text: "second" });
    await flush();
    expect(startSession).toHaveBeenCalledTimes(2);

    fromUI({ type: "open", sessionId: "sess-0" }); // return to the stopped session
    await flush();
    fromUI({ type: "send", text: "resume" });
    await flush();
    expect(startSession).toHaveBeenCalledTimes(3); // respawned (lazy resume), not reused
    expect((handles[2] as any).opts.sessionId).toBe("sess-0"); // resumed the same canonical session
    expect(handles[2].send).toHaveBeenCalledWith("resume", undefined);
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

describe("chat/session — slash commands", () => {
  it("routes /compact and /diff to the active engine handle", async () => {
    const { handles, fromUI } = harness();

    fromUI({ type: "slashCommand", command: "compact", arg: "repo state" });
    await flush();
    expect(handles[0].runSlashCommand).toHaveBeenCalledWith("compact", "repo state");

    fromUI({ type: "slashCommand", command: "diff" });
    await flush();
    expect(handles[0].runSlashCommand).toHaveBeenCalledWith("diff");
  });

  it("/clear resets the active context without spawning an engine turn", async () => {
    const { handles, startSession, fromUI, transport } = harness();

    fromUI({ type: "send", text: "hi" });
    await flush();
    expect(startSession).toHaveBeenCalledTimes(1);

    fromUI({ type: "clear" });
    await flush();
    expect(handles[0].stop).toHaveBeenCalledTimes(1);
    expect(startSession).toHaveBeenCalledTimes(1);
    expect(transport.send).toHaveBeenCalledWith({ type: "clear" });
  });

  it("/status surfaces active engine, session, config, and last usage", async () => {
    const { handles, fromUI, transport } = harness();

    fromUI({ type: "send", text: "hi" });
    await flush();
    handles[0].emitUsage(1234);

    fromUI({ type: "slashCommand", command: "status" });
    await flush();
    expect(transport.send).toHaveBeenCalledWith({
      type: "status",
      status: {
        cli: "claude",
        sessionId: "sess-0",
        model: "default",
        mode: "acceptEdits",
        effort: "default",
        contextTokens: 1234,
      },
    });
  });

  it("/resume refreshes sessions and gives a visible instruction", async () => {
    const { fromUI, transport } = harness();

    fromUI({ type: "slashCommand", command: "resume" });
    await flush();
    expect(transport.send).toHaveBeenCalledWith({ type: "sessions", list: [], activeId: undefined });
    expect(transport.send).toHaveBeenCalledWith({ type: "notice", text: "Resume: open a session from History." });
  });

  it("aliases /cost to the same status payload", async () => {
    const { handles, fromUI, transport } = harness();

    fromUI({ type: "send", text: "hi" });
    await flush();
    handles[0].emitUsage(77);

    fromUI({ type: "slashCommand", command: "cost" });
    await flush();
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({
      type: "status",
      status: expect.objectContaining({ contextTokens: 77 }),
    }));
  });

  it("/permissions reports current mode and available modes", async () => {
    const { fromUI, transport } = harness();

    fromUI({ type: "slashCommand", command: "permissions" });
    await flush();
    expect(transport.send).toHaveBeenCalledWith({
      type: "notice",
      text: expect.stringContaining("Current permission mode: acceptEdits"),
    });
  });

  it("/skills refreshes owned skills", async () => {
    const { fromUI, transport } = harness({ ownedSkills: ["clean-code"] });

    fromUI({ type: "slashCommand", command: "skills" });
    await flush();
    expect(transport.send).toHaveBeenCalledWith({
      type: "ownedSkills",
      names: ["clean-code"],
      mints: {},
      disposedMints: {},
      workflowMints: [],
    });
  });

  it("/review and /mcp route to the active engine handle", async () => {
    const { handles, fromUI } = harness();

    fromUI({ type: "slashCommand", command: "review", arg: "security" });
    await flush();
    expect(handles[0].runSlashCommand).toHaveBeenCalledWith("review", "security");

    fromUI({ type: "slashCommand", command: "mcp" });
    await flush();
    expect(handles[0].runSlashCommand).toHaveBeenCalledWith("mcp", undefined);
  });

  it("forwards unknown slash commands to the active engine", async () => {
    const { handles, fromUI } = harness();

    fromUI({ type: "slashCommand", command: "theme", arg: "dark" });
    await flush();

    expect(handles[0].runSlashCommand).toHaveBeenCalledWith("theme", "dark");
  });

  it("/init creates CLAUDE.md for Claude and AGENTS.md for Codex", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "agentnet-init-"));
    try {
      const { fromUI, transport } = harness({ cwd });

      fromUI({ type: "slashCommand", command: "init" });
      await waitForNotice(transport, "Created CLAUDE.md.");
      await expect(readFile(join(cwd, "CLAUDE.md"), "utf8")).resolves.toContain("Project instructions for Claude Code.");

      fromUI({ type: "platform", cli: "codex" });
      await flush();
      fromUI({ type: "slashCommand", command: "init" });
      await waitForNotice(transport, "Created AGENTS.md.");
      await expect(readFile(join(cwd, "AGENTS.md"), "utf8")).resolves.toContain("Project instructions for Codex.");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
