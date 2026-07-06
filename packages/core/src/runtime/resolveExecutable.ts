import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

// Resolve an executable's absolute path via which/where, cached per name.
//
// Why this matters: a GUI-launched VSCode extension host does NOT inherit the shell
// PATH, so bare names like "claude"/"codex" fail to spawn. The chat path and the model
// listers must pass an explicit resolved path (pathToClaudeCodeExecutable / codexPath)
// or the subprocess never starts. Returns undefined when the tool is not found, letting
// callers fall back (bare name or static baseline).
const exeCache = new Map<string, string | null>();

export function resolveExecutable(name: string): string | undefined {
  if (!exeCache.has(name)) {
    try {
      const cmd = process.platform === "win32" ? "where" : "which";
      const out = execFileSync(cmd, [name], { encoding: "utf8" }).split("\n")[0]?.trim();
      exeCache.set(name, out && existsSync(out) ? out : null);
    } catch {
      exeCache.set(name, null);
    }
  }
  return exeCache.get(name) ?? undefined;
}
