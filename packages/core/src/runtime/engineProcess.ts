/// <reference path="./read-cmd-shim.d.ts" />
import crossSpawn from "cross-spawn";
import readCmdShim from "read-cmd-shim";
import { dirname, resolve } from "node:path";
import type { SpawnOptions } from "@anthropic-ai/claude-agent-sdk";

// cross-spawn preserves Node's stdio behavior but its typings omit the overloads
// that narrow piped streams. Keep that contract at the shared import boundary.
export const spawnEngine = ((command, args, options) => {
  // Global npm shims require another cmd parsing pass, which can reinterpret
  // quoted arguments. Resolve their target as npm does for a symlink instead.
  // cross-spawn then follows the target's shebang without passing through cmd.
  if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command)) {
    command = resolve(dirname(command), readCmdShim.sync(command));
  }
  return crossSpawn(command, args, options);
}) as typeof import("node:child_process").spawn;

// Adapt the SDK process contract to the same Windows-aware launcher used by the
// login, version and Codex paths. Forward the SDK's delayed abort signal so its
// graceful stdin shutdown still gets a chance to finish.
export function spawnClaudeProcess({ command, args, cwd, env, signal }: SpawnOptions) {
  return spawnEngine(command, args, { cwd, env, signal, stdio: "pipe", windowsHide: true });
}
