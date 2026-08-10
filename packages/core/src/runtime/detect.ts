// CLI availability check for onboarding. Standalone (no wallet/storage) —
// answers "is codex/claude installed, and logged in?" so the UI can guide setup.

import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { access, readdir } from "node:fs/promises";
import { isClaudeLoggedIn } from "../account/claudeAuth.js";
import { isCodexLoggedIn } from "../account/codexAuth.js";

export type CliStatus = "ok" | "no-login" | "missing";
export interface CliReport {
  codex: CliStatus;
  claude: CliStatus;
}

function isInstalled(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(cmd, ["--version"], { stdio: ["ignore", "ignore", "ignore"] });
    p.on("error", () => resolve(false));
    p.on("exit", () => resolve(true));
  });
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// A PATH lookup alone routinely lies here: launchers, IDE spawns, and cron run with a
// bare PATH, so an engine installed via nvm (per-node-version bin dir), the native
// claude installer, homebrew, volta, bun, or pnpm reads as "missing" while the user is
// literally running it in another window. Resolve against the usual homes before
// giving up; cache per process.
const resolvedBins: Partial<Record<"claude" | "codex", string>> = {};

export async function resolveEngineBin(name: "claude" | "codex"): Promise<string> {
  const cached = resolvedBins[name];
  if (cached) return cached;
  let bin: string = name;
  if (!(await isInstalled(name))) {
    const home = homedir();
    const candidates = [
      ...(name === "claude" ? [join(home, ".claude", "local", "claude")] : []),
      join(home, ".local", "bin", name),
      `/opt/homebrew/bin/${name}`,
      `/usr/local/bin/${name}`,
      join(home, ".volta", "bin", name),
      join(home, ".bun", "bin", name),
      join(home, "Library", "pnpm", name),
    ];
    // nvm keeps one global-bin dir per node version — scan them all, newest first.
    const nvmRoot = join(home, ".nvm", "versions", "node");
    try {
      for (const v of (await readdir(nvmRoot)).sort().reverse()) {
        candidates.push(join(nvmRoot, v, "bin", name));
      }
    } catch {
      /* no nvm */
    }
    for (const c of candidates) {
      if (await exists(c)) {
        bin = c;
        break;
      }
    }
  }
  resolvedBins[name] = bin;
  return bin;
}

async function checkClaude(): Promise<CliStatus> {
  const bin = await resolveEngineBin("claude");
  if (!(await isInstalled(bin))) return "missing";
  return (await isClaudeLoggedIn(bin)) ? "ok" : "no-login";
}

async function checkCodex(): Promise<CliStatus> {
  const bin = await resolveEngineBin("codex");
  if (!(await isInstalled(bin))) return "missing";
  return (await isCodexLoggedIn(bin)) ? "ok" : "no-login";
}

export async function detectCli(): Promise<CliReport> {
  const [codex, claude] = await Promise.all([checkCodex(), checkClaude()]);
  return { codex, claude };
}
