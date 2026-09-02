// Custom engine warning copy, split from customEngineAuth because that file needs
// node:fs while the SPA connect form must render these strings verbatim from a
// browser bundle. This leaf stays node-free (like engineRegistry) so every surface
// reads the one definition instead of hardcoding drifting copies.

// Shown verbatim by any connect UI before a custom endpoint is saved.
export const CUSTOM_ENGINE_EGRESS_WARNING =
  "Custom engines send your prompts, files, and tool output to the endpoint you configure. Only connect endpoints you trust with that data.";
export const CUSTOM_ENGINE_TOOL_WARNING =
  "The endpoint must speak the OpenAI Responses API with tool calling (codex 0.146 dropped the chat completions wire); plain chat endpoints need a translator in front.";
