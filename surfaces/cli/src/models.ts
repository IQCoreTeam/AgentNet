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

// Share concurrent reads, but refresh the next time a picker opens. A failed probe
// must not pin the fallback for the rest of the process.
const probes = new Map<EngineKey, Promise<ChatModelOption[]>>();

export function loadModelOptions(cli: EngineKey): Promise<ChatModelOption[]> {
  // The custom catalog is whatever model the saved endpoint config names. Re-read every
  // time (a tiny local json) instead of caching, so a reconnect with a different model
  // shows up without relaunching; empty when no model is set (endpoint default).
  if (cli === "custom") {
    return loadCustomEngineConfig()
      .then((cfg) => cfg ? customModelOption(cfg.model, cfg.label) : MODELS.custom)
      .catch(() => MODELS.custom);
  }
  const pending = probes.get(cli);
  if (pending) return pending;
  const probe = cli === "codex"
    ? listCodexModelOptions().then((r) => r.options)
    : listClaudeModelOptions(process.cwd());
  const result = probe
    .then((live) => live?.length ? live : MODELS[cli])
    .catch(() => MODELS[cli])
    .finally(() => probes.delete(cli));
  probes.set(cli, result);
  return result;
}
