export type EngineKey = "claude" | "codex";

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
// picker shows its actual name (e.g. "Opus 4.8") instead of an opaque "default" chip.
// This is only the offline/fallback baseline — surfaces upgrade to the CLI's live list.
export const CHAT_MODEL_OPTIONS: Record<EngineKey, ChatModelOption[]> = {
  claude: [
    {
      value: "opus",
      chipLabel: "Opus 4.8",
      label: "Opus 4.8",
      description: "Most capable · Claude alias: opus",
    },
    {
      value: "sonnet",
      chipLabel: "Sonnet 4.6",
      label: "Sonnet 4.6",
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
};

export function findChatModelOption(cli: EngineKey, model?: string): ChatModelOption | undefined {
  const opts = CHAT_MODEL_OPTIONS[cli];
  return opts.find((opt) => (opt.value ?? "default") === (model ?? "default"));
}
