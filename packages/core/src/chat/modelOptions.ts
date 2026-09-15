import type { EngineKey } from "../runtime/engineRegistry.js";

export type { EngineKey } from "../runtime/engineRegistry.js";

export type ChatModelOption = {
  value?: string;
  chipLabel: string;
  label: string;
  description: string;
};

// One shared model catalog for every surface. The runtime only cares about the raw
// `value` (passed as the CLI/app-server model override); surfaces use the richer
// labels/descriptions so the picker is understandable instead of exposing bare aliases.
// No bare "default" pseudo-entry: the first real model is the sensible default, and the
// picker shows its actual name (e.g. "Opus 5") instead of an opaque "default" chip.
// This is only the offline/fallback baseline — surfaces upgrade to the CLI's live list.
export const CHAT_MODEL_OPTIONS: Record<EngineKey, ChatModelOption[]> = {
  claude: [
    {
      value: "opus",
      chipLabel: "Opus 5",
      label: "Opus 5",
      description: "Most capable · Claude alias: opus",
    },
    {
      value: "sonnet",
      chipLabel: "Sonnet 5",
      label: "Sonnet 5",
      description: "Balanced · Claude alias: sonnet",
    },
    {
      value: "haiku",
      chipLabel: "Haiku 4.5",
      label: "Haiku 4.5",
      description: "Fastest · Claude alias: haiku",
    },
  ],
  codex: [
    {
      value: "gpt-5.5-codex",
      chipLabel: "GPT-5.5 Codex",
      label: "GPT-5.5 Codex",
      description: "Coding-tuned · exact value: gpt-5.5-codex",
    },
    {
      value: "gpt-5.5",
      chipLabel: "GPT-5.5",
      label: "GPT-5.5",
      description: "General GPT model · exact value: gpt-5.5",
    },
  ],
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

export function findChatModelOption(cli: EngineKey, model?: string): ChatModelOption | undefined {
  const opts = CHAT_MODEL_OPTIONS[cli];
  return opts.find((opt) => (opt.value ?? "default") === (model ?? "default"));
}
