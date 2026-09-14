import crossSpawn from "cross-spawn";
import type { SpawnOptions } from "@anthropic-ai/claude-agent-sdk";

// cross-spawn preserves Node's stdio behavior but its typings omit the overloads
// that narrow piped streams. Keep that contract at the shared import boundary.
export const spawnEngine = crossSpawn as typeof import("node:child_process").spawn;

// Adapt the SDK process contract to the same Windows-aware launcher used by the
// login, version and Codex paths. Forward the SDK's delayed abort signal so its
// graceful stdin shutdown still gets a chance to finish.
export function spawnClaudeProcess({ command, args, cwd, env, signal }: SpawnOptions) {
  return spawnEngine(command, args, { cwd, env, signal, stdio: "pipe", windowsHide: true });
}
