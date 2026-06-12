// CLI availability check for onboarding. Standalone (no wallet/storage) —
// answers "is codex/claude installed, and logged in?" so the UI can guide setup.

import { spawn } from "node:child_process";

export type CliStatus = "ok" | "no-login" | "missing";
export interface CliReport {
  codex: CliStatus;
  claude: CliStatus;
}

// Run `<cmd> <args>` and resolve {code, out, missing}. missing=true on ENOENT.
function run(cmd: string, args: string[]): Promise<{ code: number | null; out: string; missing: boolean }> {
  return new Promise((resolve) => {
    let out = "";
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    p.stdout?.on("data", (d) => (out += d.toString()));
    p.stderr?.on("data", (d) => (out += d.toString()));
    p.on("error", () => resolve({ code: null, out: "", missing: true }));
    p.on("exit", (code) => resolve({ code, out, missing: false }));
  });
}

async function checkClaude(): Promise<CliStatus> {
  const v = await run("claude", ["--version"]);
  if (v.missing) return "missing";
  // `claude auth status` prints JSON ({ loggedIn, authMethod, apiProvider }) and exits 1
  // when logged out. Parse loggedIn to tell "installed but no subscription" from "ready".
  const s = await run("claude", ["auth", "status"]);
  if (!s.missing) {
    try {
      if (JSON.parse(s.out.match(/\{[\s\S]*\}/)?.[0] ?? "{}").loggedIn === true) return "ok";
      return "no-login";
    } catch {
      // older claude without `auth status` JSON: fall back to "ok" (login surfaces on use)
    }
  }
  return "ok";
}

async function checkCodex(): Promise<CliStatus> {
  const v = await run("codex", ["--version"]);
  if (v.missing) return "missing";
  const status = await run("codex", ["login", "status"]);
  if (!status.missing && /not logged in|logged out|no auth/i.test(status.out)) return "no-login";
  return "ok";
}

export async function detectCli(): Promise<CliReport> {
  const [codex, claude] = await Promise.all([checkCodex(), checkClaude()]);
  return { codex, claude };
}
