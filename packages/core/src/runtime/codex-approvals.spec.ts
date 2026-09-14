import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnEngine as spawn } from "./engineProcess.js";
import { spawnCli } from "./spawn.js";

vi.mock("./engineProcess.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./engineProcess.js")>(),
  spawnEngine: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

// Exercise the production engine through its JSON-RPC boundary. Only the child
// transport is simulated; no Codex process, model request or wallet is involved.
describe.each([
  { cli: "codex", sessionId: undefined },
  { cli: "codex", sessionId: "existing-thread" },
  { cli: "custom", sessionId: undefined },
  { cli: "custom", sessionId: "existing-thread" },
] as const)("Codex startup and usage ($cli, session $sessionId)", ({ cli, sessionId }) => {
  it.each([
    { mode: "auto", override: "", policy: "on-request", sandbox: "workspace-write" },
    { mode: "readonly", override: "", policy: "on-request", sandbox: "read-only" },
    { mode: "full", override: "", policy: "never", sandbox: "danger-full-access" },
    { mode: undefined, override: "", policy: "on-request", sandbox: undefined },
    { mode: "auto", override: "danger-full-access", policy: "on-request", sandbox: "danger-full-access" },
    { mode: "readonly", override: "danger-full-access", policy: "on-request", sandbox: "danger-full-access" },
    { mode: "full", override: "danger-full-access", policy: "never", sandbox: "danger-full-access" },
  ])("$mode with sandbox override '$override'", async ({ mode, override, policy, sandbox }) => {
    vi.stubEnv("AGENTNET_CODEX_SANDBOX", override);
    const requests: { id: number; method: string; params: Record<string, unknown> }[] = [];
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = Object.assign(new EventEmitter(), {
      stdout,
      stderr,
      stdin: new Writable({
        write(chunk, _encoding, done) {
          const request = JSON.parse(chunk.toString());
          requests.push(request);
          queueMicrotask(() => stdout.write(JSON.stringify({
            id: request.id,
            result: { thread: { id: sessionId ?? "new-thread" } },
          }) + "\n"));
          done();
        },
      }),
      kill: () => {
        queueMicrotask(() => {
          stdout.end();
          stderr.end();
          child.emit("exit", 0, null);
        });
        return true;
      },
    });
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const approve = vi.fn(async () => ({ outcome: "once" as "once" | "deny" | "always" }));
    const engine = spawnCli({ approval: { request: approve }, cli, cwd: process.cwd(), mode, sessionId, ...(cli === "custom" ? { custom: { baseUrl: "http://127.0.0.1:11669/v1", model: "mock-model", apiKey: "", presetId: "manual" } } : {}) });
    const usage = vi.fn();
    engine.onUsage(usage);
    const opened = vi.fn();
    engine.onSessionId(opened);
    try {
      await vi.waitFor(() => expect(opened).toHaveBeenCalled());
      expect(requests.map((r) => r.method)).toEqual([
        "initialize", sessionId ? "thread/resume" : "thread/start",
      ]);
      expect(requests[1].params).toMatchObject({ approvalPolicy: policy, approvalsReviewer: "user" });
      expect(requests[1].params.sandbox).toBe(sandbox);
      expect(requests[1].params.modelProvider).toBe(cli === "custom" ? "custom" : undefined);
      // A second turn adds to billed totals, not to current context occupancy.
      for (const [total, last] of [[40000, 20000], [60000, 21000], [61000, 1000]]) {
        stdout.write(JSON.stringify({ method: "thread/tokenUsage/updated", params: {
          tokenUsage: { total: { totalTokens: total }, last: { totalTokens: last }, modelContextWindow: 32000 },
        } }) + "\n");
        expect(usage).toHaveBeenLastCalledWith(last, 32000);
      }
      for (const [id, outcome] of (["once", "deny", "always"] as const).entries()) {
        approve.mockResolvedValueOnce({ outcome });
        stdout.write(JSON.stringify({ id: 100 + id, method: "mcpServer/elicitation/request", params: {
          threadId: sessionId ?? "new-thread", serverName: "qa_fixture", mode: "form",
          message: "Allow fixture read?", requestedSchema: { type: "object", properties: {} },
          _meta: { codex_approval_kind: "mcp_tool_call", tool_params: {}, persist: ["session", "always"] },
        } }) + "\n");
        await vi.waitFor(() => expect(requests.find(r => r.id === 100 + id)).toMatchObject({ result: {
          action: outcome === "deny" ? "decline" : "accept",
          content: outcome === "deny" ? null : {},
          _meta: outcome === "always" ? { persist: "always" } : null,
        } }));
        expect(approve).toHaveBeenLastCalledWith(expect.objectContaining({ cli, title: "Allow fixture read?" }));
      }
      approve.mockClear();
      stdout.write(JSON.stringify({ id: 200, method: "mcpServer/elicitation/request", params: {
        serverName: "qa_fixture", mode: "form", message: "Enter a value",
        requestedSchema: { type: "object", properties: { value: { type: "string" } } },
        _meta: { codex_approval_kind: "mcp_tool_call" },
      } }) + "\n");
      await vi.waitFor(() => expect(requests.find(r => r.id === 200)).toMatchObject({ error: { code: -32602 } }));
      expect(approve).not.toHaveBeenCalled();
    } finally {
      engine.stop?.();
    }
  });
});
