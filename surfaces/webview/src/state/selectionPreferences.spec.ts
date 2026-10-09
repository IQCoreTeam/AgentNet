import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SELECTION_PREFERENCES, readSelectionPreferences, writeSelectionPreferences } from "./selectionPreferences";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("selection preferences", () => {
  it("keeps guest and wallet choices separate across reloads", () => {
    const guest = { ...DEFAULT_SELECTION_PREFERENCES, cli: "codex" as const, modelByCli: { ...DEFAULT_SELECTION_PREFERENCES.modelByCli, codex: "gpt-5-codex" }, effortByCli: { ...DEFAULT_SELECTION_PREFERENCES.effortByCli, codex: "high" } };
    const wallet = { ...DEFAULT_SELECTION_PREFERENCES, modelByCli: { ...DEFAULT_SELECTION_PREFERENCES.modelByCli, claude: "sonnet" }, effortByCli: { ...DEFAULT_SELECTION_PREFERENCES.effortByCli, claude: "medium" } };
    writeSelectionPreferences(null, guest);
    writeSelectionPreferences("wallet-one", wallet);

    expect(readSelectionPreferences(null)).toEqual(guest);
    expect(readSelectionPreferences("wallet-one")).toEqual(wallet);
    expect(readSelectionPreferences("wallet-two")).toEqual(DEFAULT_SELECTION_PREFERENCES);
  });

  it("persists only engine, model and effort, even if the supplied object has other fields", () => {
    writeSelectionPreferences(null, { ...DEFAULT_SELECTION_PREFERENCES, modeByCli: { codex: "full" }, apiKey: "synthetic-test-key" } as typeof DEFAULT_SELECTION_PREFERENCES);
    expect(JSON.parse(localStorage.getItem("agentnet.chatSelection.v1:guest")!)).toEqual(DEFAULT_SELECTION_PREFERENCES);
  });

  it("uses defaults for malformed or unavailable storage", () => {
    localStorage.setItem("agentnet.chatSelection.v1:guest", "{broken");
    expect(readSelectionPreferences(null)).toEqual(DEFAULT_SELECTION_PREFERENCES);
    localStorage.setItem("agentnet.chatSelection.v1:guest", JSON.stringify({ cli: "invalid", modelByCli: { claude: 42 }, effortByCli: { codex: "" }, modeByCli: { claude: "bypassPermissions" } }));
    expect(readSelectionPreferences(null)).toEqual(DEFAULT_SELECTION_PREFERENCES);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("disabled"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disabled"); });
    expect(readSelectionPreferences(null)).toEqual(DEFAULT_SELECTION_PREFERENCES);
    expect(() => writeSelectionPreferences(null, DEFAULT_SELECTION_PREFERENCES)).not.toThrow();
  });
});
