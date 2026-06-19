// CLI availability check for onboarding. Standalone (no wallet/storage) —
// answers "is codex/claude installed, and logged in?" so the UI can guide setup.

import { spawn } from "node:child_process";
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

async function checkClaude(): Promise<CliStatus> {
  if (!(await isInstalled("claude"))) return "missing";
  return (await isClaudeLoggedIn()) ? "ok" : "no-login";
}

async function checkCodex(): Promise<CliStatus> {
  if (!(await isInstalled("codex"))) return "missing";
  return (await isCodexLoggedIn()) ? "ok" : "no-login";
}

export async function detectCli(): Promise<CliReport> {
  const [codex, claude] = await Promise.all([checkCodex(), checkClaude()]);
  return { codex, claude };
}
