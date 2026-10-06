import { describe, expect, it } from "vitest";
import { initialState, reducer } from "./store";

describe("chat selection restoration", () => {
  it("restores each engine's settings on a fresh load and retains them across a repaint", () => {
    let state = reducer(initialState, { type: "settings", cli: "claude", model: "sonnet", effort: "high", mode: "plan" });
    state = reducer(state, { type: "settings", cli: "codex", model: "gpt-5-codex", effort: "xhigh", mode: "readonly" });
    state = reducer(state, { type: "platform", cli: "codex" });
    state = reducer(state, { type: "clear" });

    expect(state.cli).toBe("codex");
    expect(state.modelByCli).toEqual({ claude: "sonnet", codex: "gpt-5-codex", custom: "default" });
    expect(state.effortByCli).toEqual({ claude: "high", codex: "xhigh", custom: "default" });
    expect(state.modeByCli).toEqual({ claude: "plan", codex: "readonly", custom: "auto" });
  });

  it("replaces an old selection with engine defaults when the restored snapshot omits it", () => {
    const selected = reducer(initialState, { type: "settings", cli: "claude", model: "sonnet", effort: "high", mode: "plan" });
    const restored = reducer(selected, { type: "settings", cli: "claude" });

    expect(restored.modelByCli.claude).toBe("default");
    expect(restored.effortByCli.claude).toBe("default");
    expect(restored.modeByCli.claude).toBe("acceptEdits");
  });

  it("rejects a late settings or status snapshot after the user selects another session", () => {
    let state = reducer(initialState, { type: "sessions", list: [], activeId: "first" });
    state = reducer(state, { type: "settings", cli: "claude", sessionId: "first", model: "sonnet", effort: "high", mode: "plan" });
    state = reducer(state, { type: "__openingSession", sessionId: "second" });

    expect(reducer(state, { type: "settings", cli: "claude", sessionId: "first", model: "haiku", effort: "low" })).toBe(state);
    expect(reducer(state, { type: "status", status: { cli: "claude", sessionId: "first", model: "haiku", effort: "low" } })).toBe(state);
    const opened = reducer(state, { type: "settings", cli: "claude", sessionId: "second", model: "opus", effort: "medium", mode: "default" });
    expect(opened.modelByCli.claude).toBe("opus");
    expect(opened.effortByCli.claude).toBe("medium");
    expect(opened.modeByCli.claude).toBe("default");
  });

  it("files an optimistic selection under its originating engine if an engine switch arrives first", () => {
    let state = reducer(initialState, { type: "platform", cli: "codex" });
    state = reducer(state, { type: "__modelChange", cli: "claude", model: "sonnet" });
    state = reducer(state, { type: "__effortChange", cli: "claude", effort: "high" });
    state = reducer(state, { type: "__changeMode", cli: "claude", mode: "plan" });

    expect(state.cli).toBe("codex");
    expect(state.modelByCli.codex).toBe("default");
    expect(state.effortByCli.codex).toBe("default");
    expect(state.modeByCli.codex).toBe("auto");
    expect(state.modelByCli.claude).toBe("sonnet");
    expect(state.effortByCli.claude).toBe("high");
    expect(state.modeByCli.claude).toBe("plan");
  });

  it("restores settings from status without inventing a context window", () => {
    const state = reducer(initialState, { type: "status", status: { cli: "codex", model: "gpt-5-codex", effort: "high", mode: "readonly", contextTokens: 12_000 } });

    expect(state.modelByCli.codex).toBe("gpt-5-codex");
    expect(state.effortByCli.codex).toBe("high");
    expect(state.modeByCli.codex).toBe("readonly");
    expect(state.toast).toContain("ctx 12k tokens (model limit unverified)");
    expect(state.toast).not.toContain("%");
    const verified = reducer(state, { type: "status", status: { cli: "codex", contextTokens: 12_000, contextWindow: 120_000 } });
    expect(verified.toast).toContain("ctx 12k / 120k (10%)");
  });
});

describe("context usage", () => {
  it("clears an earlier model's reported limit when the next usage event has no limit", () => {
    const known = reducer(initialState, { type: "usage", contextTokens: 20_000, contextWindow: 100_000 });
    const unknown = reducer(known, { type: "usage", contextTokens: 25_000 });

    expect(unknown.contextTokens).toBe(25_000);
    expect(unknown.contextWindow).toBeUndefined();
  });

  it("clears usage when a model is picked locally or restored by the server", () => {
    const known = reducer(initialState, { type: "usage", contextTokens: 20_000, contextWindow: 100_000 });
    const picked = reducer(known, { type: "__modelChange", cli: "claude", model: "sonnet" });
    expect(picked.contextTokens).toBeUndefined();
    expect(picked.contextWindow).toBeUndefined();
    const restored = reducer(known, { type: "settings", cli: "claude", model: "sonnet" });
    expect(restored.contextTokens).toBeUndefined();
    expect(restored.contextWindow).toBeUndefined();
    const background = reducer(known, { type: "settings", cli: "codex", model: "gpt-5-codex" });
    expect(background.contextTokens).toBe(20_000);
    expect(background.contextWindow).toBe(100_000);
  });
});
