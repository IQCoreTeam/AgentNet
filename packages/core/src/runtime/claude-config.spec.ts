import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnCli } from "./spawn.js";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: vi.fn() }));
vi.mock("./engineBin.js", () => ({ resolveEngineBin: () => "/fixture/claude" }));

let stateDir: string;
beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "agentnet-claude-config-"));
  vi.stubEnv("AGENTNET_HOME", stateDir);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  rmSync(stateDir, { recursive: true, force: true });
});

function mockQuery() {
  const stream = Object.assign(new PassThrough({ objectMode: true }), { interrupt: vi.fn(async () => {}) });
  vi.mocked(query).mockReturnValue(stream as unknown as ReturnType<typeof query>);
  return stream;
}

describe("Claude SDK configuration", () => {
  it.each([undefined, "default", "low", "medium", "high", "xhigh", "max"])("passes supported effort %s", effort => {
    const stream = mockQuery();
    const engine = spawnCli({ cli: "claude", cwd: "/fixture", effort });
    expect(vi.mocked(query).mock.calls[0][0].options?.effort).toBe(effort === "default" ? undefined : effort);
    engine.stop();
    stream.end();
  });

  it("rejects another engine's effort instead of casting it into the SDK", () => {
    expect(() => spawnCli({ cli: "claude", cwd: "/fixture", effort: "ultra" }))
      .toThrow("Unsupported Claude effort level: ultra");
    expect(query).not.toHaveBeenCalled();
  });

  it.each([undefined, "default", "acceptEdits", "plan", "bypassPermissions"])("maps permission mode %s", mode => {
    const stream = mockQuery();
    const engine = spawnCli({ cli: "claude", cwd: "/fixture", mode });
    const options = vi.mocked(query).mock.calls[0][0].options;
    expect(options?.permissionMode).toBe(mode ?? "default");
    if (mode === "bypassPermissions") expect(options?.allowDangerouslySkipPermissions).toBe(true);
    else expect(options).not.toHaveProperty("allowDangerouslySkipPermissions");
    engine.stop();
    stream.end();
  });

  it("pairs last main request tokens with its actual model window and clears unavailable limits", async () => {
    const stream = mockQuery();
    const engine = spawnCli({ cli: "claude", cwd: "/fixture", model: "opus" });
    const usage = vi.fn();
    engine.onUsage(usage);
    const assistant = (model: string, input_tokens: number, parent_tool_use_id: string | null = null) => ({
      type: "assistant", parent_tool_use_id,
      message: { model, content: [], usage: { input_tokens, output_tokens: 20, cache_read_input_tokens: 30 } },
    });
    const result = (modelUsage: Record<string, unknown>) => ({ type: "result", modelUsage, usage: { input_tokens: 99000 } });
    try {
      stream.write(assistant("main-model", 100));
      await vi.waitFor(() => expect(usage).toHaveBeenLastCalledWith(130, undefined));
      stream.write(assistant("main-model", 200));
      stream.write(assistant("subagent-model", 8000, "agent-call"));
      stream.write(result({ "main-model": { contextWindow: 1000000 }, "subagent-model": { contextWindow: 200000 } }));
      await vi.waitFor(() => expect(usage).toHaveBeenLastCalledWith(230, 1000000));
      expect(usage.mock.calls.map(call => call[0])).not.toContain(8030);

      stream.write(assistant("new-model", 300));
      stream.write(result({ "subagent-model": { contextWindow: 200000 } }));
      await vi.waitFor(() => expect(usage).toHaveBeenLastCalledWith(330, undefined));

      stream.write(assistant("canonical-main-model", 400));
      stream.write(result({ "provider-specific-model": { canonicalModel: "canonical-main-model", contextWindow: 256000 } }));
      await vi.waitFor(() => expect(usage).toHaveBeenLastCalledWith(430, 256000));

      stream.write(assistant("canonical-main-model", 500));
      stream.write(result({
        "provider-specific-model": { canonicalModel: "canonical-main-model", contextWindow: 256000 },
        "another-provider-model": { canonicalModel: "canonical-main-model", contextWindow: 1000000 },
      }));
      await vi.waitFor(() => expect(usage).toHaveBeenLastCalledWith(530, undefined));
      const calls = usage.mock.calls.length;
      stream.write(result({ "main-model": { contextWindow: 1000000 } }));
      await new Promise(resolve => setImmediate(resolve));
      expect(usage).toHaveBeenCalledTimes(calls);
    } finally {
      engine.stop();
      stream.end();
    }
  });
});
