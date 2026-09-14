// CLI availability check for onboarding. Standalone (no wallet/storage) —
// answers "is codex/claude installed, and logged in?" so the UI can guide setup.

import { spawn } from "node:child_process";
import { isClaudeLoggedIn } from "../account/claudeAuth.js";
import { isCodexLoggedIn } from "../account/codexAuth.js";
import { resolveEngineBin } from "./engineBin.js";

export type CliStatus = "ok" | "no-login" | "missing" | "node-missing";
export interface CliReport {
  codex: CliStatus;
  claude: CliStatus;
}

function isInstalled(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(cmd, ["--version"], { stdio: ["ignore", "ignore", "ignore"] });
    p.on("error", () => resolve(false));
    // A launcher that starts and dies nonzero (127 from `env: node`, 126 or 127 from its exec
    // target, a --version that crashes) is not installed for this host, and a signal exit (code
    // null) is not either. A missing file or a wrong-arch binary already took the error path.
    p.on("exit", (code) => resolve(code === 0));
  });
}

// Where the binary lives is engineBin.ts's job (a GUI-launched host has no shell PATH);
// this module only answers whether that binary runs and is signed in.
async function checkClaude(): Promise<CliStatus> {
  const bin = resolveEngineBin("claude");
  if (!(await isInstalled(bin))) return "missing";
  return (await isClaudeLoggedIn(bin)) ? "ok" : "no-login";
}

async function checkCodex(): Promise<CliStatus> {
  const bin = resolveEngineBin("codex");
  if (!(await isInstalled(bin))) return "missing";
  return (await isCodexLoggedIn(bin)) ? "ok" : "no-login";
}

export async function detectCli(): Promise<CliReport> {
  const [codex, claude] = await Promise.all([checkCodex(), checkClaude()]);
  return { codex, claude };
}
