// One behavior registry for every engine. "custom" (issue #209) is an OpenAI-compatible
// endpoint driven through the codex binary via provider overrides, so most call sites
// only need the descriptor's `binary` to know how to treat it. Pure data on purpose:
// browser surfaces import this transitively (modelOptions), so keep it free of node
// imports, like engineInstall.ts.

export type EngineKey = "claude" | "codex" | "custom";

// key names the row it sits in, binary drives engine dispatch, label names the
// engine where a surface needs a display name, memoryFile picks the native
// project-instructions file. loginKind and modelSource used to live here too but
// nothing ever read them, so they are gone (CODE-RULES: no dead data).
export interface EngineDescriptor {
  key: EngineKey;
  label: string;
  binary: "claude" | "codex"; // which CLI process actually runs
  memoryFile: "CLAUDE.md" | "AGENTS.md"; // native project-instructions file
}

export const ENGINE_REGISTRY: Record<EngineKey, EngineDescriptor> = {
  claude: { key: "claude", label: "Claude", binary: "claude", memoryFile: "CLAUDE.md" },
  codex: { key: "codex", label: "Codex", binary: "codex", memoryFile: "AGENTS.md" },
  custom: { key: "custom", label: "Custom", binary: "codex", memoryFile: "AGENTS.md" },
};

export const ENGINE_KEYS = Object.keys(ENGINE_REGISTRY) as EngineKey[];

export function engineBinary(key: EngineKey): "claude" | "codex" {
  return ENGINE_REGISTRY[key].binary;
}

// Persisted logs may carry a cli string this build doesn't know (a newer engine, or a
// hand-edited log). Unknown strings behave like codex - the passthrough binary - so
// readers keep working instead of crashing on the union.
export function coerceEngineKey(cli: string): EngineKey {
  return (ENGINE_KEYS as string[]).includes(cli) ? (cli as EngineKey) : "codex";
}

// Hosts receive `cli` as an untrusted message field, but installs, updates and
// sign-outs act on the BINARY, so "custom" (and any unknown or non-string value)
// resolves through the registry to the CLI process it runs on. One derivation for
// every host instead of a copy in each message handler.
export function messageBinary(cli: unknown): "claude" | "codex" {
  return engineBinary(coerceEngineKey(typeof cli === "string" ? cli : "claude"));
}
