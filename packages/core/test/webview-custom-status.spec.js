import { expect, it } from "vitest";
import { engineStatus, reducer } from "../../../surfaces/webview/src/state/store";

it("Custom inherits missing runtime status but not Codex login requirements", () => {
  const state = { customEngine: { masked: "fixture.invalid" }, cliReport: { claude: "ok", codex: "node-missing" } };
  expect(engineStatus(state, "custom")).toBe("node-missing");
  expect(engineStatus({ ...state, cliReport: { claude: "ok", codex: "no-login" } }, "custom")).toBe("ok");
});

it("Custom status reports tokens without a provider limit, including stale window state", () => {
  const state = { contextWindow: 256000 };
  const result = reducer(state, { type: "status", status: { cli: "custom", contextTokens: 12000, contextWindow: 256000 } });
  expect(result.toast).toContain("ctx 12k tokens (provider limit unknown)");
  expect(result.toast).not.toMatch(/256|%/);
});
it("status uses the reporting engine's window rather than the visible engine's stale window", () => {
  const result = reducer({ contextWindow: 256000 }, { type: "status", status: { cli: "claude", contextTokens: 10000, contextWindow: 100000 } });
  expect(result.toast).toContain("ctx 10k / 100k (10%)");
});
