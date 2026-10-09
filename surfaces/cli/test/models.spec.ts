import { beforeEach, describe, expect, it, vi } from "vitest";

const catalog = vi.hoisted(() => ({
  claude: vi.fn(), codex: vi.fn(), custom: vi.fn(),
  baseline: {
    claude: [{ value: "opus", chipLabel: "Opus", label: "Opus", description: "offline" }],
    codex: [{ value: "offline-codex", chipLabel: "Codex", label: "Codex", description: "offline" }],
    custom: [],
  },
}));
vi.mock("@iqlabs-official/agent-sdk", () => ({
  CHAT_MODEL_OPTIONS: catalog.baseline,
  customModelOption: (model: string, label?: string) => model ? [{ value: model, label }] : [],
  listClaudeModelOptions: catalog.claude,
  listCodexModelOptions: catalog.codex,
  loadCustomEngineConfig: catalog.custom,
}));
import { loadModelOptions } from "../src/models.js";

beforeEach(() => vi.resetAllMocks());

describe("CLI model catalogs", () => {
  it("shares concurrent reads, then refreshes after the catalog settles", async () => {
    const live = [{ value: "new-model", label: "New", supportedEfforts: ["high", "ultra"] }];
    let resolve!: (value: typeof live) => void;
    catalog.claude.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const first = loadModelOptions("claude");
    const second = loadModelOptions("claude");
    expect(second).toBe(first);
    expect(catalog.claude).toHaveBeenCalledTimes(1);
    resolve(live);
    expect(await first).toEqual(live);

    catalog.claude.mockResolvedValueOnce([{ value: "updated-model" }]);
    expect(await loadModelOptions("claude")).toEqual([{ value: "updated-model" }]);
    expect(catalog.claude).toHaveBeenCalledTimes(2);
  });

  it("retries a failed or empty probe rather than caching the fallback forever", async () => {
    catalog.codex.mockRejectedValueOnce(new Error("offline"));
    expect(await loadModelOptions("codex")).toBe(catalog.baseline.codex);
    catalog.codex.mockResolvedValueOnce({ options: [] });
    expect(await loadModelOptions("codex")).toBe(catalog.baseline.codex);
    const live = [{ value: "recovered-model", supportedEfforts: ["minimal"] }];
    catalog.codex.mockResolvedValueOnce({ options: live });
    expect(await loadModelOptions("codex")).toEqual(live);
    expect(catalog.codex).toHaveBeenCalledTimes(3);
  });

  it("re-reads custom configuration and tolerates a failed read", async () => {
    catalog.custom.mockResolvedValueOnce({ model: "endpoint-one", label: "One" });
    expect(await loadModelOptions("custom")).toEqual([{ value: "endpoint-one", label: "One" }]);
    catalog.custom.mockRejectedValueOnce(new Error("unreadable"));
    expect(await loadModelOptions("custom")).toBe(catalog.baseline.custom);
    catalog.custom.mockResolvedValueOnce({ model: "endpoint-two", label: "Two" });
    expect(await loadModelOptions("custom")).toEqual([{ value: "endpoint-two", label: "Two" }]);
  });
});
