// Dispatcher regression: changing the permission mode (or model) while a session is
// live must NOT interrupt the in-flight turn. The old handler stopped the handle on
// the toggle (claude q.interrupt / codex child.kill), killing the turn the user was
// watching. The fix is lazy-restage: keep the running handle, re-spawn on the NEXT
// send carrying the live sessionId so the turn finishes and the new mode applies next.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createChatSession } from "./session.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// The sessionIndex dispatcher case is the only consumer of these two modules here.
// Mock them whole: the real ones reach for the chain (solana web3 + config files),
// and the case's contract — who gets called, with what, and what the reply echoes —
// is exactly what these tests pin down.
vi.mock("../account/login.js", () => ({
  getSessionIndex: vi.fn(async () => false),
  setSessionIndex: vi.fn(async () => {}),
}));
vi.mock("../account/sessionIndex.js", () => ({
  backfillSessionIndex: vi.fn(async () => ({ written: 0, already: 0 })),
  sessionIndexStatus: vi.fn(async () => ({ enabled: false, onChain: [], chainOnly: [], truncated: false })),
}));
import { getSessionIndex, setSessionIndex } from "../account/login.js";
import { backfillSessionIndex, sessionIndexStatus } from "../account/sessionIndex.js";

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

function harness(opts: { cwd?: string; ownedSkills?: string[]; googleCredsConfigured?: boolean; signingWallet?: () => any } = {}) {
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
    storageInfo: async () => ({ info: {}, options: [], googleCredsConfigured: opts.googleCredsConfigured }),
    ownedSkills: opts.ownedSkills ? async () => opts.ownedSkills : undefined,
    // absent by default: the guest surface (localhost without a wallet) offers no
    // signingWallet at all, which is its own case in the sessionIndex tests below.
    signingWallet: opts.signingWallet,
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

describe("chat/session — storage setup state", () => {
  it("preserves whether Google OAuth credentials are configured", async () => {
    const { fromUI, transport } = harness({ googleCredsConfigured: true });

    fromUI({ type: "ready" });
    await flush();

    expect(transport.send).toHaveBeenCalledWith({
      type: "storage",
      info: {},
      options: [],
      googleCredsConfigured: true,
    });
  });
});

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
    expect(transport.send).toHaveBeenCalledWith({ type: "sessions", list: [], activeId: undefined, running: [], cloud: "none" });
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
    // ownedSkillsMsg lazy-imports skillSource.js (a heavy module graph — seconds on a
    // cold vitest worker), so the reply can land long after any fixed flush — poll on
    // real time like waitForNotice does. `meta` is best-effort display data read from
    // whatever catalog cache the machine has, so pin the contract fields and leave it free.
    for (let i = 0; i < 500; i++) {
      if (transport.send.mock.calls.some((c: any[]) => c[0]?.type === "ownedSkills")) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({
      type: "ownedSkills",
      names: ["clean-code"],
      mints: {},
      disposedMints: {},
      workflowMints: [],
    }));
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

// The on-chain session index round-trip (plans/offchain-session-sync.md §4-5): the
// dispatcher owns the whole flow, hosts only supply the SIGNING wallet. Every row
// write is a PAID Solana transaction, so the contracts pinned here — the wallet
// gate, 'on' running the one-shot backfill, 'off' never touching the chain, errors
// echoing the config-read toggle — are the ones a regression would turn into
// surprise prompts, duplicate fees, or a lying switch.
describe("chat/session — on-chain session index", () => {
  const wallet = { address: "WaLLetAddr111", signMessage: async () => new Uint8Array() };
  const chainRow = (id: string) => ({ sessionId: id, modelType: "claude" as const, createdAt: 0, updatedAt: 0 });

  beforeEach(() => {
    vi.mocked(getSessionIndex).mockReset().mockResolvedValue(true);
    vi.mocked(setSessionIndex).mockReset().mockResolvedValue(undefined);
    vi.mocked(backfillSessionIndex).mockReset().mockResolvedValue({ written: 0, already: 0 });
    vi.mocked(sessionIndexStatus).mockReset().mockResolvedValue({ enabled: true, onChain: [], chainOnly: [], truncated: false });
  });

  const statusMsgs = (transport: any) =>
    transport.send.mock.calls.map((c: any[]) => c[0]).filter((m: any) => m?.type === "sessionIndexStatus");

  // the chain work runs off the pump, so the reply lands asynchronously — poll for it
  const waitForStatus = async (transport: any) => {
    for (let i = 0; i < 200; i++) {
      const got = statusMsgs(transport);
      if (got.length) return got[got.length - 1];
      await new Promise((r) => setTimeout(r, 0));
    }
    throw new Error("sessionIndexStatus was never sent");
  };

  it("stays silent on a surface with no signingWallet hook (guest can't sign or pay)", async () => {
    const { fromUI, transport } = harness(); // env.signingWallet absent entirely
    fromUI({ type: "sessionIndex", action: "on" });
    await flush();
    expect(statusMsgs(transport)).toHaveLength(0);
    expect(setSessionIndex).not.toHaveBeenCalled();
    expect(backfillSessionIndex).not.toHaveBeenCalled();
    expect(sessionIndexStatus).not.toHaveBeenCalled();
  });

  it("stays silent when signingWallet() returns null (localhost guest key)", async () => {
    const { fromUI, transport } = harness({ signingWallet: () => null });
    fromUI({ type: "sessionIndex", action: "status" });
    await flush();
    expect(statusMsgs(transport)).toHaveLength(0);
    expect(sessionIndexStatus).not.toHaveBeenCalled();
  });

  it("'status' reports the chain counts without toggling config or writing rows", async () => {
    vi.mocked(sessionIndexStatus).mockResolvedValue({
      enabled: true,
      onChain: [chainRow("a"), chainRow("b")],
      chainOnly: [chainRow("b")],
      truncated: true,
    });
    const { fromUI, transport } = harness({ signingWallet: () => wallet });
    fromUI({ type: "sessionIndex", action: "status" });
    const msg = await waitForStatus(transport);
    expect(msg).toEqual({ type: "sessionIndexStatus", enabled: true, listed: 2, elsewhere: 1, truncated: true, written: undefined });
    expect(sessionIndexStatus).toHaveBeenCalledWith(wallet.address, []);
    expect(setSessionIndex).not.toHaveBeenCalled();
    expect(backfillSessionIndex).not.toHaveBeenCalled(); // a paid write on a status read = money
  });

  it("'on' flips the per-wallet config AND runs the one-shot backfill (CLI parity)", async () => {
    vi.mocked(backfillSessionIndex).mockResolvedValue({ written: 3, already: 2 });
    const { fromUI, transport } = harness({ signingWallet: () => wallet });
    fromUI({ type: "sessionIndex", action: "on" });
    const msg = await waitForStatus(transport);
    expect(setSessionIndex).toHaveBeenCalledWith(wallet.address, true);
    expect(backfillSessionIndex).toHaveBeenCalledWith(wallet, []);
    expect(msg.written).toBe(3);
    expect(msg.error).toBeUndefined();
  });

  it("'off' confirms from config alone — no chain read, no error even with RPC down", async () => {
    // chain fully dark: if 'off' touched it, the reply would carry an error
    vi.mocked(sessionIndexStatus).mockRejectedValue(new Error("rpc unreachable"));
    vi.mocked(backfillSessionIndex).mockRejectedValue(new Error("rpc unreachable"));
    const { fromUI, transport } = harness({ signingWallet: () => wallet });
    fromUI({ type: "sessionIndex", action: "off" });
    const msg = await waitForStatus(transport);
    expect(setSessionIndex).toHaveBeenCalledWith(wallet.address, false);
    expect(msg).toEqual({ type: "sessionIndexStatus", enabled: false });
    expect(sessionIndexStatus).not.toHaveBeenCalled();
    expect(backfillSessionIndex).not.toHaveBeenCalled();
  });

  it("a failed action reports its reason with the toggle re-read from config", async () => {
    vi.mocked(backfillSessionIndex).mockRejectedValue(new Error("a backfill is already running for this wallet"));
    vi.mocked(getSessionIndex).mockResolvedValue(true); // config says on — the switch must stay truthful
    const { fromUI, transport } = harness({ signingWallet: () => wallet });
    fromUI({ type: "sessionIndex", action: "backfill" });
    const msg = await waitForStatus(transport);
    expect(msg).toEqual({ type: "sessionIndexStatus", enabled: true, error: "a backfill is already running for this wallet" });
  });

  it("chain work runs OFF the pump: a hung RPC read never blocks later messages", async () => {
    vi.mocked(sessionIndexStatus).mockImplementation(() => new Promise(() => {})); // never resolves
    const { fromUI, transport } = harness({ signingWallet: () => wallet });
    fromUI({ type: "sessionIndex", action: "status" });
    fromUI({ type: "slashCommand", command: "permissions" });
    await flush();
    // the strictly-ordered queue must have moved past the hung chain read
    expect(transport.send).toHaveBeenCalledWith({
      type: "notice",
      text: expect.stringContaining("Current permission mode"),
    });
    expect(statusMsgs(transport)).toHaveLength(0); // still hung, still silent — and that's fine
  });
});
