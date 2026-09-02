// Custom engine (issue #209) safety rails. Each of these is a silent-failure class:
// a missing config would run stock codex on the user's OpenAI account, a phantom
// env_key handling protects keyless local endpoints, and a blank model makes codex quietly use
// its own global default model. Pin all three to throw or emit correctly.
import { describe, it, expect } from "vitest";
import { spawnCli, customProviderFlags } from "./spawn.js";
import { saveCustomEngineConfig, type CustomEngineConfig } from "../account/customEngineAuth.js";

const NOT_CONFIGURED = "Custom engine is not configured. Connect an endpoint before starting a custom session.";
const NEEDS_MODEL = "The custom engine needs a model id; codex would otherwise silently use its own default model.";

const cfg = (over: Partial<CustomEngineConfig> = {}): CustomEngineConfig => ({
  baseUrl: "http://localhost:11434/v1",
  apiKey: "",
  model: "llama3",
  presetId: "ollama",
  ...over,
});

describe("runtime/spawn — custom engine gates", () => {
  it("spawnCli throws loudly on a custom spawn with no config (never silently runs stock codex)", () => {
    expect(() => spawnCli({ cli: "custom", cwd: "/tmp" })).toThrow(NOT_CONFIGURED);
  });

  it("customProviderFlags declares env_key even keyless: without it codex sends the user's own ChatGPT token to the endpoint", () => {
    const flags = customProviderFlags(cfg());
    expect(flags).toContain(`model_providers.custom.env_key=${JSON.stringify("CUSTOM_ENGINE_API_KEY")}`);
  });

  it("customProviderFlags emits env_key when a key is configured", () => {
    const flags = customProviderFlags(cfg({ apiKey: "sk-test" }));
    expect(flags).toContain(`model_providers.custom.env_key=${JSON.stringify("CUSTOM_ENGINE_API_KEY")}`);
    // the key itself must never ride argv
    expect(flags.join(" ")).not.toContain("sk-test");
  });

  it("customProviderFlags throws on a blank model instead of letting codex pick its default", () => {
    expect(() => customProviderFlags(cfg({ model: "" }))).toThrow(NEEDS_MODEL);
  });
});

describe("account/customEngineAuth — saveCustomEngineConfig validation", () => {
  it("rejects a blank model before anything reaches disk", async () => {
    await expect(saveCustomEngineConfig(cfg({ model: "" }))).rejects.toThrow(NEEDS_MODEL);
    await expect(saveCustomEngineConfig(cfg({ model: "   " }))).rejects.toThrow(NEEDS_MODEL);
  });

  it("rejects a base URL that is not http(s)", async () => {
    await expect(saveCustomEngineConfig(cfg({ baseUrl: "not a url" }))).rejects.toThrow(/not a valid URL/);
    await expect(saveCustomEngineConfig(cfg({ baseUrl: "ftp://host/v1" }))).rejects.toThrow(/must be http or https/);
  });
});
