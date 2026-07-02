import {
  CHAT_MODEL_OPTIONS,
  listClaudeModelOptions,
  listCodexModelOptions,
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
  let cached = cache.get(cli);
  if (!cached) {
    const probe = cli === "codex" ? listCodexModelOptions() : listClaudeModelOptions(process.cwd());
    cached = probe.then((live) => (live?.length ? live : MODELS[cli])).catch(() => MODELS[cli]);
    cache.set(cli, cached);
  }
  return cached;
}
