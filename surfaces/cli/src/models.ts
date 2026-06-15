// Known model choices per engine for the /models picker. The CLIs accept these short
// aliases (and full ids); "default" clears the override so the engine's own default runs.
export const MODELS: Record<"claude" | "codex", { label: string; value?: string; hint: string }[]> = {
  claude: [
    { label: "default", value: undefined, hint: "engine default" },
    { label: "opus", value: "opus", hint: "most capable (Opus 4.8)" },
    { label: "sonnet", value: "sonnet", hint: "balanced (Sonnet 4.6)" },
    { label: "haiku", value: "haiku", hint: "fast (Haiku 4.5)" },
  ],
  codex: [
    { label: "default", value: undefined, hint: "engine default" },
    { label: "gpt-5.5", value: "gpt-5.5", hint: "Codex default" },
    { label: "gpt-5.5-codex", value: "gpt-5.5-codex", hint: "coding-tuned" },
  ],
};
