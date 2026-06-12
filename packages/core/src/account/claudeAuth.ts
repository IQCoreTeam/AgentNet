// Claude subscription login, device-local. AgentNet runs the official claude CLI inside
// the proot guest and lets the user sign in with THEIR OWN Claude subscription (Max/Pro)
// — the product's whole point is "your subscription on your phone", not API metering.
//
// Flow (measured against claude 2.1.x on-device):
//   `claude auth login --claudeai` prints, to stdout:
//     Opening browser to sign in…
//     If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?...
//     Paste code here if prompted >
//   then waits on stdin for the code. The user opens that URL in their phone browser,
//   authorizes, copies the returned code, and we write it to the process's stdin. The CLI
//   then persists its own credentials (~/.claude/.credentials.json) inside the guest.
//
// We never see or store the long-lived token ourselves — the CLI owns it, device-local.
// (This matters for policy: we go through the official Agent SDK / CLI and never proxy
// the user's OAuth token off-device.) The only thing we persist is a tiny marker so the
// onboarding can skip the login screen on next launch; the real auth lives in the CLI.

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { tokenFile, tokensDir, ensureDir } from "../core/paths.js";

// A login session in flight: the spawned `claude auth login` process + the URL we parsed
// from its output. Held while we wait for the user to paste the code back.
export interface ClaudeLogin {
  url: string;
  submitCode(code: string): void; // write the pasted code to the CLI's stdin
  cancel(): void;
  done: Promise<boolean>; // resolves true on successful login, false on failure/cancel
}

// Start `claude auth login --claudeai` and resolve once we've parsed the OAuth URL from
// its stdout. The returned handle lets the caller relay the user's pasted code and await
// the result. Rejects if the process dies or no URL appears before it exits.
export function startClaudeLogin(claudeBin = "claude"): Promise<ClaudeLogin> {
  return new Promise((resolve, reject) => {
    const child = spawn(claudeBin, ["auth", "login", "--claudeai"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let buf = "";
    let urlSent = false;
    let settleDone: (ok: boolean) => void;
    const done = new Promise<boolean>((r) => (settleDone = r));

    const onData = (d: Buffer) => {
      buf += d.toString();
      if (!urlSent) {
        // "...visit: https://claude.com/cai/oauth/authorize?...<newline>"
        const m = buf.match(/https:\/\/claude\.com\/\S*oauth\S*/);
        if (m) {
          urlSent = true;
          resolve({
            url: m[0],
            submitCode(code: string) {
              child.stdin.write(code.trim() + "\n");
            },
            cancel() {
              child.kill();
            },
            done,
          });
        }
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData); // the CLI may print the prompt on either stream

    child.on("error", (e) => {
      if (!urlSent) reject(e);
      settleDone(false);
    });
    child.on("exit", (code) => {
      // exit 0 after we've sent the URL = the code was accepted and login succeeded.
      if (!urlSent) reject(new Error("claude auth login exited before emitting a URL"));
      else settleDone(code === 0);
    });
  });
}

// Whether the claude CLI reports an active subscription/login. Parses `claude auth status`
// JSON ({ loggedIn, authMethod, apiProvider }); exit code is 1 when logged out.
export async function isClaudeLoggedIn(claudeBin = "claude"): Promise<boolean> {
  return new Promise((resolve) => {
    let out = "";
    const p = spawn(claudeBin, ["auth", "status"], { stdio: ["ignore", "pipe", "pipe"] });
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (out += d.toString()));
    p.on("error", () => resolve(false));
    p.on("exit", () => {
      try {
        resolve(JSON.parse(out.match(/\{[\s\S]*\}/)?.[0] ?? "{}").loggedIn === true);
      } catch {
        resolve(false);
      }
    });
  });
}

// Tiny device-local marker that the user has connected their Claude subscription. The
// REAL credentials live in the CLI's own store inside the guest; this just lets the
// onboarding skip the login screen without re-running `auth status` cold. Never synced.
export async function markClaudeConnected(): Promise<void> {
  await ensureDir(tokensDir());
  await writeFile(tokenFile("claude"), JSON.stringify({ connected: true }), { mode: 0o600 });
}

export async function isClaudeMarked(): Promise<boolean> {
  try {
    const data = JSON.parse(await readFile(tokenFile("claude"), "utf8")) as { connected?: boolean };
    return data.connected === true;
  } catch {
    return false;
  }
}
