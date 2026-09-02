import {
  CHAT_MODEL_OPTIONS,
  customModelOption,
  listClaudeModelOptions,
  listCodexModelOptions,
  loadCustomEngineConfig,
  type ChatModelOption,
  type EngineKey,
} from "@iqlabs-official/agent-sdk";

// Static baseline shown instantly (and the fallback when the live probe fails).
export const MODELS = CHAT_MODEL_OPTIONS;

// Live catalog from the installed CLI, cached per engine so the probe subprocess spins up
// once. Returns the static baseline on any failure (no CLI, logged out, timeout) so the
// picker is never blocked. Mirrors how VSCode/localhost wire the modelOptions hook.
const cache = new Map<EngineKey, Promise<ChatModelOption[]>>();

export function loadModelOptions(cli: EngineKey): Promise<ChatModelOption[]> {
  // The custom catalog is whatever model the saved endpoint config names. Re-read every
  // time (a tiny local json) instead of caching, so a reconnect with a different model
  // shows up without relaunching; empty when no model is set (endpoint default).
  if (cli === "custom") {
    return loadCustomEngineConfig().then((cfg) =>
      cfg ? customModelOption(cfg.model, cfg.label) : MODELS.custom,
    );
  }
  let cached = cache.get(cli);
  if (!cached) {
    const probe =
      cli === "codex" ? listCodexModelOptions().then((r) => r.options) : listClaudeModelOptions(process.cwd());
    cached = probe.then((live) => (live?.length ? live : MODELS[cli])).catch(() => MODELS[cli]);
    cache.set(cli, cached);
  }
  return cached;
}
