import { describe, expect, it } from "vitest";
import { findChatModelOption, modelEffortOptions, normalizeModelEffort, type ChatModelOption } from "./modelOptions.js";

const catalog: ChatModelOption[] = [
  { value: "latest", resolvedModel: "canonical-latest", chipLabel: "Latest", label: "Latest", description: "", supportedEfforts: ["low", "ultra"] },
  { value: "fast", chipLabel: "Fast", label: "Fast", description: "", supportedEfforts: [] },
];
describe("model capabilities", () => {
  it("uses the recommendation for default, while preserving unknown explicit IDs", () => {
    expect(findChatModelOption(catalog)).toBe(catalog[0]);
    expect(findChatModelOption(catalog, "default")).toBe(catalog[0]);
    expect(findChatModelOption(catalog, "fast")).toBe(catalog[1]);
    expect(findChatModelOption(catalog, "canonical-latest")).toBe(catalog[0]);
    expect(findChatModelOption(catalog, "unlisted")).toBeUndefined();
  });
  it("accepts new advertised effort levels and clears unsupported selections", () => {
    expect(modelEffortOptions(catalog[0]).map(option => option.value)).toEqual(["default", "low", "ultra"]);
    expect(normalizeModelEffort(catalog[0], "ultra")).toBe("ultra");
    expect(normalizeModelEffort(catalog[1], "ultra")).toBeUndefined();
    expect(modelEffortOptions(undefined).map(option => option.value)).toEqual(["default"]);
    expect(normalizeModelEffort(undefined, "high")).toBeUndefined();
  });
});
