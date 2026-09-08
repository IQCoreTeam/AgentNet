// One source of truth for "where is the claude/codex binary", and for the PATH we hand
// their child processes.
//
// Every surface that is NOT a terminal hits the same wall: a GUI-launched process (VS
// Code opened from the Dock, the desktop app, launchd, cron) inherits the bare launchd
// PATH — /usr/bin:/bin:/usr/sbin:/sbin — not the user's shell PATH. An engine installed
// by nvm / fnm / mise / asdf / volta / bun / pnpm / homebrew therefore reads as missing
// while the user is literally running it in another window.
//
// Getting this wrong is worse than a bad status line. @anthropic-ai/claude-agent-sdk
// falls back to ITS OWN bundled native CLI whenever pathToClaudeCodeExecutable is
// undefined, and the packaged VS Code extension ships no node_modules (vsce runs with
// --no-dependencies), so that fallback can never resolve. The user gets "Native CLI
// binary for darwin-arm64 not found. Reinstall @anthropic-ai/claude-agent-sdk…", which
// blames the SDK for a PATH problem. Always passing an explicit absolute path is what
// keeps the shipped extension working; the bare-name fallback below exists only so a
// genuinely-missing engine fails as a plain ENOENT, which the install notice explains.
//
// Sync on purpose: this feeds default parameters and the SDK options object, and every
// step is a filesystem stat or one cheap `which`. Successful lookups are cached.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

export type EngineName = "claude" | "codex";

// Escape hatch for installs no candidate list can predict (nix, a custom npm prefix, a
// corporate image). Surfaces expose it as a setting and set it here; see the VS Code
// extension's agentnet.claudePath / agentnet.codexPath.
const OVERRIDE_ENV: Record<EngineName, string> = {
  claude: "AGENTNET_CLAUDE_PATH",
  codex: "AGENTNET_CODEX_PATH",
};

const resolved = new Map<EngineName, string>();

function fromPath(name: string): string | undefined {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const hit = execFileSync(cmd, [name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")[0]
      ?.trim();
    return hit && existsSync(hit) ? hit : undefined;
  } catch {
    return undefined;
  }
}

// Newest first, compared numerically: a plain string sort ranks v9 above v10, so the
// version managers below would hand back a years-old runtime's bin dir.
function newestFirst(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".");
  const pb = b.replace(/^v/, "").split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (Number(pb[i]) || 0) - (Number(pa[i]) || 0);
    if (d) return d;
  }
  return 0;
}

// Version managers keep one bin dir per installed runtime version; expand them all.
function versionedBins(root: string, tail: string[], exe: string): string[] {
  try {
    return readdirSync(root)
      .sort(newestFirst)
      .map((v) => join(root, v, ...tail, exe));
  } catch {
    return []; // that manager isn't installed
  }
}

// The install homes worth checking when PATH comes up empty, in preference order.
function candidates(name: EngineName): string[] {
  const home = homedir();
  const win = process.platform === "win32";
  const exe = win ? `${name}.cmd` : name;
  return [
    // the official native installer
    ...(name === "claude" ? [join(home, ".claude", "local", "claude")] : []),
    join(home, ".local", "bin", exe),
    // node version managers: one global-bin dir per runtime version, newest first
    ...versionedBins(join(home, ".nvm", "versions", "node"), ["bin"], exe),
    ...versionedBins(join(home, "Library", "Application Support", "fnm", "node-versions"), ["installation", "bin"], exe),
    ...versionedBins(join(home, ".local", "share", "fnm", "node-versions"), ["installation", "bin"], exe),
    ...versionedBins(join(home, ".local", "share", "mise", "installs", "node"), ["bin"], exe),
    ...versionedBins(join(home, ".asdf", "installs", "nodejs"), ["bin"], exe),
    ...versionedBins("/usr/local/n/versions/node", ["bin"], exe),
    // single-prefix installs
    join(home, ".volta", "bin", exe),
    join(home, ".bun", "bin", exe),
    join(home, "Library", "pnpm", exe),
    join(home, ".local", "share", "pnpm", exe),
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    ...(win ? [join(process.env.APPDATA ?? "", "npm", exe)] : []),
  ];
}

// Finding the binary is only half the job: `codex` ships as a `#!/usr/bin/env node`
// shim, so an absolute path still dies with "env: node: No such file or directory"
// when node isn't on PATH — and the agent's own Bash tool calls would likewise find no
// node/npm/git. Both live in the bin dir we just resolved, so put it on PATH.
//
// Mutating process.env is deliberate. Every spawn site in core (detect, engineVersions,
// claudeAuth, codexAuth, the two model listers, both engines) inherits process.env, so
// repairing it HERE fixes all of them at once; threading an env object through each
// call instead would duplicate the same fix seven times and silently miss the eighth.
// Idempotent, and only ever adds a directory that really holds the engine.
function putOnPath(dir: string): void {
  const parts = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  if (parts.includes(dir)) return;
  process.env.PATH = [dir, ...parts].join(delimiter);
}

// Absolute path to the engine, or the bare name when it genuinely isn't installed.
export function resolveEngineBin(name: EngineName): string {
  // Validate the cache on read instead of trusting it for the whole process life. A global
  // upgrade (nvm/brew/pnpm) or an interrupted `npm install -g` — the same one that leaves a
  // half-linked package — can delete or replace the bin symlink we resolved earlier. Without
  // this stat we'd keep spawning a now-dangling absolute path and fail every turn with a bare
  // ENOENT until the app was reloaded, even after the user reinstalled the engine. existsSync
  // follows symlinks, so a dangling link reads as missing too; dropping the stale entry lets
  // the lookup below re-resolve (and re-runs putOnPath for the new bin dir). One filesystem
  // stat on the hot path, in keeping with this module's stat-per-step design.
  const cached = resolved.get(name);
  if (cached && existsSync(cached)) return cached;
  if (cached) resolved.delete(name);

  const override = process.env[OVERRIDE_ENV[name]]?.trim();
  if (override && !existsSync(override)) {
    // The escape hatch exists for people whose install we can't guess, so failing it
    // silently would strand exactly them. Say so, then fall back to auto-detection.
    console.error(`[agentnet] ${OVERRIDE_ENV[name]} points at a missing file, ignoring: ${override}`);
  }
  const bin =
    (override && existsSync(override) ? override : undefined) ??
    fromPath(name) ??
    candidates(name).find(existsSync);

  // A miss is never cached: the surfaces offer an in-app `npm install -g` and then poll
  // detectCli, so a sticky "not found" would keep reporting missing until a reload.
  if (!bin) return name;
  resolved.set(name, bin);
  putOnPath(dirname(bin));
  return bin;
}
