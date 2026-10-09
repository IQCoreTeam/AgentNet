import { describe, expect, it, vi } from "vitest";

const { supportedModels, close } = vi.hoisted(() => ({
  supportedModels: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: () => ({ supportedModels, return: close }),
}));
vi.mock("./engineBin.js", () => ({ resolveEngineBin: () => "claude" }));
import { listClaudeModelOptions } from "./claudeModels.js";

describe("Claude catalog labels", () => {
  it("shows the recommended Opus model once when default resolves to it", async () => {
    supportedModels.mockResolvedValue([
      { value: "default", displayName: "Default (recommended)", description: "Opus 5.5 · Recommended", supportsEffort: true, supportedEffortLevels: ["low", "high", "max"] },
      { value: "opus", displayName: "Opus", description: "Opus 5.5 · Most capable", supportsEffort: true, supportedEffortLevels: ["low", "high", "max"] },
    ]);
    const options = await listClaudeModelOptions();
    expect(options?.map(option => [option.value, option.chipLabel])).toEqual([
      ["opus", "Opus 5.5"],
    ]);
    expect(options?.[0].supportedEfforts).toEqual(["low", "high", "max"]);
    expect(close).toHaveBeenCalled();
  });
});

describe("Claude catalog refresh", () => {
  it("keeps a distinct recommendation and does not cache the next probe", async () => {
    supportedModels.mockResolvedValueOnce([
      { value: "default", displayName: "Default (recommended)", description: "Sonnet 5.5 · Recommended" },
      { value: "opus", displayName: "Opus", description: "Opus 5.5 · Most capable" },
    ]).mockResolvedValueOnce([
      { value: "haiku", displayName: "Haiku", description: "Haiku 4.5 · Fastest", supportsEffort: false, supportedEffortLevels: ["high"] },
    ]);
    expect((await listClaudeModelOptions())?.map(option => option.value)).toEqual(["default", "opus"]);
    expect((await listClaudeModelOptions())?.[0].supportedEfforts).toEqual([]);
  });
});

it("preserves different canonical models even when their labels coincide", async () => {
  supportedModels.mockResolvedValue([
    { value: "default", displayName: "Default (recommended)", description: "Opus 5.5 · Recommended", resolvedModel: "opus-5-5-1m" },
    { value: "opus", displayName: "Opus", description: "Opus 5.5 · Most capable", resolvedModel: "opus-5-5" },
  ]);
  expect((await listClaudeModelOptions())?.map(option => option.value)).toEqual(["default", "opus"]);
});
