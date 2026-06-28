import { describe, it, expect, vi } from "vitest";

// Fake Codex engine: on send(), echoes the goal as an assistant message + one file
// edit, then ends the turn. Records how many engines were spawned (for the clamp test).
const spawned: any[] = [];
vi.mock("./spawn.js", () => ({
  spawnCli: vi.fn((opts: any) => {
    spawned.push(opts);
    let onMsg: any = () => {};
    let onTurn: any = () => {};
    return {
      send: (text: string) => {
        onMsg({ role: "assistant", text: `did: ${text}`, ts: 0 });
        onMsg({ role: "tool", text: "edit", ts: 0, tool: { name: "Edit", file: "a.ts" } });
        onMsg({ role: "assistant", text: "partial-skip", ts: 0, partial: true });
        onTurn();
      },
      onMessage: (cb: any) => { onMsg = cb; },
      onTurnEnd: (cb: any) => { onTurn = cb; },
      onError: () => {},
      stop: vi.fn(),
    };
  }),
}));

const { runCodexTask, runCodexTasks } = await import("./codexSubagent.js");

describe("codexSubagent", () => {
  it("collects assistant text + changed files, ignores partials, resolves on turn end", async () => {
    const r = await runCodexTask({ goal: "build auth" }, "/cwd", true);
    expect(r.output).toBe("did: build auth"); // partial dropped
    expect(r.filesChanged).toEqual(["a.ts"]);
  });

  it("fans out in parallel and clamps to 4 workers", async () => {
    spawned.length = 0;
    const tasks = Array.from({ length: 6 }, (_, i) => ({ goal: `t${i}` }));
    const results = await runCodexTasks(tasks, "/cwd", false);
    expect(results).toHaveLength(4); // clamped
    expect(spawned).toHaveLength(4);
    expect(results.map((r) => r.output)).toEqual(["did: t0", "did: t1", "did: t2", "did: t3"]);
  });
});
