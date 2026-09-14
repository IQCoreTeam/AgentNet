import { describe, expect, it } from "vitest";
import { initialState, reducer } from "../../../surfaces/webview/src/state/store";

describe("webview plan limits", () => {
  const claude = { type: "rateLimit", cli: "claude", utilization: 73, window: "five_hour", status: "allowed" };

  it("keeps a plan reading with its engine through local and host switches", () => {
    let state = reducer(initialState, claude);
    state = reducer(state, { type: "__switchEngine", cli: "codex" });
    expect(state.rateLimits[state.cli]).toBeUndefined();
    state = reducer(state, { type: "clear" });
    state = reducer(state, { type: "usage", contextTokens: 24_000 });
    expect(state.contextTokens).toBe(24_000);
    expect(state.rateLimits[state.cli]).toBeUndefined();
    state = reducer(state, { type: "platform", cli: "claude" });
    expect(state.rateLimits[state.cli]?.utilization).toBe(73);
  });

  it("files a late Claude frame under Claude while Codex is selected", () => {
    let state = reducer(initialState, { type: "platform", cli: "codex" });
    state = reducer(state, claude);
    expect(state.rateLimits.codex).toBeUndefined();
    expect(state.rateLimits.claude?.utilization).toBe(73);
  });

  it("preserves status-only readings within the reporting engine", () => {
    let state = reducer(initialState, claude);
    state = reducer(state, { type: "rateLimit", cli: "codex", status: "allowed_warning" });
    expect(state.rateLimits.codex?.utilization).toBeUndefined();
    state = reducer(state, { type: "rateLimit", cli: "claude", status: "allowed_warning" });
    expect(state.rateLimits.claude?.utilization).toBe(73);
    expect(state.rateLimits.claude?.status).toBe("allowed_warning");
    state = reducer(state, { ...claude, status: "rejected", utilization: 100 });
    expect(state.rateLimits.claude?.utilization).toBe(100);
  });
});
