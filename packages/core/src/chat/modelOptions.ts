import type { EngineKey } from "../runtime/engineRegistry.js";

export type { EngineKey } from "../runtime/engineRegistry.js";

export type ChatModelOption = {
  value?: string;
  chipLabel: string;
  label: string;
  description: string;
  resolvedModel?: string;
  supportedEfforts?: string[];
};

// One shared model catalog for every surface. The runtime only cares about the raw
// `value` (passed as the CLI/app-server model override); surfaces use the richer
// labels/descriptions so the picker is understandable instead of exposing bare aliases.
// This is only the offline/fallback baseline — surfaces upgrade to the CLI's live list.
export const CHAT_MODEL_OPTIONS: Record<EngineKey, ChatModelOption[]> = {
  claude: [
    {
      value: "opus",
      chipLabel: "Opus",
      label: "Opus",
      description: "Most capable · Claude alias: opus",
    },
    {
      value: "sonnet",
      chipLabel: "Sonnet",
      label: "Sonnet",
      description: "Balanced · Claude alias: sonnet",
    },
    {
      value: "haiku",
      chipLabel: "Haiku",
      label: "Haiku",
      description: "Fastest · Claude alias: haiku",
    },
  ],
  codex: [{ chipLabel: "Default", label: "Default", description: "CLI default · live model catalog unavailable" }],
  // The custom engine has no catalog: its one model is whatever the saved endpoint
  // config names, which lives on the host side. Surfaces build the entry with
  // customModelOption from the stored config and push it over their live channel.
  custom: [],
};

// Picker entry for the configured custom-endpoint model. Empty only for a legacy
// config saved before saveCustomEngineConfig required a model id; spawn rejects
// those configs, so an empty list here matches an engine that cannot run.
export function customModelOption(model: string, label?: string): ChatModelOption[] {
  if (!model) return [];
  return [{
    value: model,
    chipLabel: model,
    label: model,
    description: (label ? label + " · " : "") + "configured endpoint model",
  }];
}

export function findChatModelOption(catalog: EngineKey | ChatModelOption[], model?: string): ChatModelOption | undefined {
  const options = typeof catalog === "string" ? CHAT_MODEL_OPTIONS[catalog] : catalog;
  return !model || model === "default" ? options[0] : options.find(option => option.value === model || option.resolvedModel === model);
}

export function normalizeModelEffort(model: ChatModelOption | undefined, effort?: string): string | undefined {
  return effort && model?.supportedEfforts?.includes(effort) ? effort : undefined;
}

// Omitted capability metadata means unknown, not support for every engine's levels.
export function modelEffortOptions(model?: ChatModelOption): { value: string; label: string }[] {
  return [{ value: "default", label: "default" }, ...(model?.supportedEfforts ?? []).map(value => ({ value, label: value === "xhigh" ? "x-high" : value }))];
}
