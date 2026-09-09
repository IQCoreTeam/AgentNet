// Custom engine config, device-local. Mirrors saveCodexApiKey: the endpoint config
// (base URL + API key + model) lives in tokens/custom-engine.json with 0o600 perms,
// per device, never synced. spawn.ts turns it into -c model_providers overrides on
// the codex binary; the key rides the CUSTOM_ENGINE_API_KEY env var, never argv.

import { readFile, writeFile, rm } from "node:fs/promises";
import { tokenFile, tokensDir, ensureDir } from "../core/paths.js";
import { engineBinary } from "../runtime/engineRegistry.js";
import { detectCli, type CliReport, type CliStatus } from "../runtime/detect.js";

export interface CustomEngineConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  presetId: string;
  label?: string;
}

export interface CustomEnginePreset {
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
}

// Starting points so connecting is a pick + key paste instead of a URL hunt. Only "manual"
// (a loopback endpoint) and "lmstudio" have carried a real turn; the hosted entries are the
// advertised base URLs and must speak the Responses wire to work through codex. "manual" is the escape hatch: any endpoint, all fields typed by hand.
// A defaultModel of "" does NOT mean the endpoint picks one: saveCustomEngineConfig
// rejects a blank model, so the connect form must require a model id for those presets.
export const CUSTOM_ENGINE_PRESETS: CustomEnginePreset[] = [
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat" },
  { id: "qwen", label: "Qwen", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultModel: "qwen-max" },
  { id: "glm", label: "GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", defaultModel: "glm-4-plus" },
  { id: "kimi", label: "Kimi", baseUrl: "https://api.moonshot.cn/v1", defaultModel: "kimi-k2" },
  { id: "ollama", label: "Ollama", baseUrl: "http://localhost:11434/v1", defaultModel: "" },
  { id: "lmstudio", label: "LM Studio", baseUrl: "http://localhost:1234/v1", defaultModel: "" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "" },
  { id: "manual", label: "Manual", baseUrl: "", defaultModel: "" },
];

// Connect-UI warning copy lives in the browser-safe leaf (customEngineMeta) so the
// SPA form can import it without this file's node:fs dependency; re-exported here so
// node hosts keep one import site for everything custom-engine.
export { CUSTOM_ENGINE_EGRESS_WARNING, CUSTOM_ENGINE_TOOL_WARNING } from "./customEngineMeta.js";

const PROVIDER = "custom-engine";

// The base URL rides codex argv as a -c override, where ps can read it, so anything
// secret-shaped is stripped before it is stored: userinfo (user:pass@) and the query
// string. The trailing slash is trimmed so the same endpoint always stores one form.
function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("The custom engine base URL is not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`The custom engine base URL must be http or https, got "${url.protocol.slice(0, -1)}".`);
  }
  // origin + pathname drops userinfo, query, and fragment in one move.
  return (url.origin + url.pathname).replace(/\/+$/, "");
}

export async function saveCustomEngineConfig(cfg: CustomEngineConfig): Promise<void> {
  // Reject a blank model at the door, not only at spawn (customProviderFlags), so a
  // bad config never even reaches disk.
  if (!cfg.model.trim()) {
    throw new Error("The custom engine needs a model id; codex would otherwise silently use its own default model.");
  }
  const normalized: CustomEngineConfig = { ...cfg, baseUrl: normalizeBaseUrl(cfg.baseUrl), model: cfg.model.trim() };
  await ensureDir(tokensDir());
  const path = tokenFile(PROVIDER);
  // Unlink before write so the new file is always created with 0o600: if the file
  // already existed with looser permissions a plain writeFile would not downgrade them.
  await rm(path, { force: true });
  await writeFile(path, JSON.stringify(normalized), { mode: 0o600 });
}

export async function loadCustomEngineConfig(): Promise<CustomEngineConfig | null> {
  try {
    const data = JSON.parse(await readFile(tokenFile(PROVIDER), "utf8")) as CustomEngineConfig;
    return data.baseUrl ? data : null;
  } catch {
    return null;
  }
}

export async function clearCustomEngineConfig(): Promise<void> {
  await rm(tokenFile(PROVIDER), { force: true });
}

export async function hasCustomEngine(): Promise<boolean> {
  return (await loadCustomEngineConfig()) !== null;
}

// The custom engine's status in CliReport's own vocabulary, so a custom row reads like the
// claude and codex rows everywhere: "missing" = no codex binary (custom runs through it),
// "no-login" = the binary is there but no endpoint is saved (the saved config IS its
// sign-in), "ok" = a custom session can actually spawn. One derivation for every host
// and surface instead of each re-deriving "codex present AND config saved". Pass a
// CliReport when one is already in hand; without one detectCli runs, the same probe
// behind every engine status line (it resolves the binary through engineBin.ts, so a
// GUI-launched host without a shell PATH still finds it).
export async function customEngineStatus(report?: CliReport): Promise<CliStatus> {
  if ((report ?? await detectCli())[engineBinary("custom")] === "missing") return "missing";
  return (await hasCustomEngine()) ? "ok" : "no-login";
}

// Masked view for the UI: endpoint host + last 4 chars of the key, rest dotted (like
// maskedHeliusKey). null when no config is stored; a keyless local endpoint shows
// just the host. The full key never leaves the host as plain text.
export async function maskedCustomEngine(): Promise<string | null> {
  const cfg = await loadCustomEngineConfig();
  if (!cfg) return null;
  let host = cfg.baseUrl;
  try {
    host = new URL(cfg.baseUrl).host;
  } catch {
    // not a parseable URL: show the raw value
  }
  if (!cfg.apiKey) return host;
  const tail = cfg.apiKey.slice(-4);
  return `${host} · ${cfg.apiKey.length <= 4 ? tail : "••••" + tail}`;
}
