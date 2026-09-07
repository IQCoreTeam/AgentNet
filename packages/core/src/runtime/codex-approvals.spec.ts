import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { spawnCli } from "./spawn.js";

vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawn: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

// Exercise the production engine through its JSON-RPC boundary. Only the child
// transport is simulated; no Codex process, model request or wallet is involved.
describe.each([undefined, "existing-thread"])("Codex approvals (session %s)", (sessionId) => {
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
    const engine = spawnCli({ cli: "codex", cwd: process.cwd(), mode, sessionId });
    const opened = vi.fn();
    engine.onSessionId(opened);
    try {
      await vi.waitFor(() => expect(opened).toHaveBeenCalled());
      expect(requests.map((r) => r.method)).toEqual([
        "initialize", sessionId ? "thread/resume" : "thread/start",
      ]);
      expect(requests[1].params).toMatchObject({ approvalPolicy: policy, approvalsReviewer: "user" });
      expect(requests[1].params.sandbox).toBe(sandbox);
    } finally {
      engine.stop?.();
    }
  });
});
