import React from "react";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChat } from "../src/hooks/useChat.js";
import type { AgentRuntime } from "@iqlabs-official/agent-sdk/runtime/contract";

const fixture = vi.hoisted(() => ({ load: vi.fn(), readPrefs: vi.fn(), savePrefs: vi.fn() }));
vi.mock("../src/models.js", () => ({
  loadModelOptions: fixture.load,
  MODELS: { claude: [], codex: [], custom: [] },
}));
vi.mock("../src/prefs.js", () => ({
  readPrefs: fixture.readPrefs,
  savePrefs: fixture.savePrefs,
  LAST_MODEL_PREF: { claude: "lastModelClaude", codex: "lastModelCodex", custom: "lastModelCustom" },
}));

const options = [
  { value: "wide", chipLabel: "Wide", label: "Wide", description: "", supportedEfforts: ["high", "ultra"] },
  { value: "compatible", chipLabel: "Compatible", label: "Compatible", description: "", supportedEfforts: ["high"] },
  { value: "limited", chipLabel: "Limited", label: "Limited", description: "", supportedEfforts: ["low"] },
];
const screens: ReturnType<typeof render>[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  fixture.load.mockResolvedValue(options);
  fixture.readPrefs.mockResolvedValue({});
  fixture.savePrefs.mockResolvedValue(undefined);
});
afterEach(() => { for (const screen of screens) screen.unmount(); screens.length = 0; });

function mount(model?: string, effort?: string) {
  let chat!: ReturnType<typeof useChat>;
  const send = vi.fn();
  const handle = {
    sessionId: "fixture-session", send, stop: vi.fn(),
    onMessage: vi.fn(), onUsage: vi.fn(), onCompact: vi.fn(), onSkill: vi.fn(), onTurnEnd: vi.fn(),
  };
  const runtime = { listSessions: vi.fn().mockResolvedValue([]), startSession: vi.fn().mockResolvedValue(handle) };
  function Probe() {
    chat = useChat(runtime as unknown as AgentRuntime, { cli: "claude", model, effort, cwd: "/fixture" });
    return null;
  }
  const stdout = Object.assign(new PassThrough(), { columns: 80, isTTY: false });
  stdout.resume();
  const stdin = Object.assign(new PassThrough(), { isTTY: false });
  screens.push(render(<Probe />, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    patchConsole: false, exitOnCtrlC: false,
  }));
  return { current: () => chat, runtime, send };
}

describe("CLI model effort state", () => {
  it("preserves a supported effort and clears it when another model rejects it", async () => {
    const p = mount("wide", "high");
    await vi.waitFor(() => expect(p.current().modelLabel).toBe("Wide"));
    p.current().changeModel("compatible");
    await vi.waitFor(() => expect(p.current().model).toBe("compatible"));
    expect(p.current().effort).toBe("high");
    p.current().changeModel("limited");
    await vi.waitFor(() => expect(p.current().model).toBe("limited"));
    expect(p.current().effort).toBeUndefined();
    expect(fixture.savePrefs).toHaveBeenCalledWith({ lastModelClaude: "limited", lastEffort: undefined });
  });

  it("does not give an unlisted model the first model's effort capabilities", async () => {
    const p = mount("unknown", "ultra");
    await vi.waitFor(() => expect(p.current().effort).toBeUndefined());
    expect(fixture.savePrefs).toHaveBeenCalledWith({ lastEffort: undefined });
  });

  it("checks effort again before a local stub session starts", async () => {
    const p = mount("wide", "high");
    await vi.waitFor(() => expect(p.current().modelLabel).toBe("Wide"));
    fixture.load.mockResolvedValue([{ ...options[0], supportedEfforts: ["low"] }]);
    await p.current().send("fixture message");
    expect(p.runtime.startSession).toHaveBeenCalledWith(expect.objectContaining({ model: "wide", effort: undefined }));
    expect(p.send).toHaveBeenCalledWith("fixture message", undefined);
    await vi.waitFor(() => expect(p.current().effort).toBeUndefined());
  });

  it("clears a model override on /model default and resets effort across an engine switch", async () => {
    const p = mount("wide", "high");
    await vi.waitFor(() => expect(p.current().modelLabel).toBe("Wide"));
    p.current().changeModel("default");
    await vi.waitFor(() => expect(p.current().model).toBeUndefined());
    expect(p.current().effort).toBe("high");
    expect(p.current().modelLabel).toBe("Wide");
    fixture.load.mockImplementation(async (cli: string) => cli === "codex" ? [options[2]] : options);
    p.current().switchEngine("codex");
    await vi.waitFor(() => expect(p.current().cli).toBe("codex"));
    expect(p.current().effort).toBeUndefined();
  });
});
