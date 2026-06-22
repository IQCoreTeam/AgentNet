// Codex login, device-local. Mirrors claudeAuth.ts for the Claude engine.
//
// Flow (codex 0.139 --device-auth, measured from actual output):
//   `codex login --device-auth` prints to stdout:
//     "Open this link in your browser and sign in to your account"
//     "  https://auth.openai.com/codex/device"
//     "Enter this one-time code (expires in 15 minutes)"
//     "  IJ7I-WTCF3"
//   then polls silently until the code is entered on the website. No stdin.
//
// We parse the URL + code, show them to the user, and wait for process exit.
// Exit 0 = success. We never see or store the session token — codex CLI owns it
// in ~/.codex/auth.json, device-local.

import { spawn } from "node:child_process";
import { readFile, writeFile, rm } from "node:fs/promises";
import { tokenFile, tokensDir, ensureDir } from "../core/paths.js";

export interface CodexLogin {
  url: string;
  code: string;
  cancel(): void;
  done: Promise<boolean>; // resolves true on success, false on failure/cancel
}

// Strip ANSI escape codes so regex matches work on coloured terminal output.
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function codexLoginStartupError(buf: string): Error {
  const clean = stripAnsi(buf).trim();
  return new Error(clean ? `codex login exited before showing a device code:\n${clean}` : "codex login exited before showing a device code");
}

export function startCodexLogin(codexBin = "codex"): Promise<CodexLogin> {
  return new Promise((resolve, reject) => {
    const child = spawn(codexBin, ["login", "--device-auth"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let buf = "";
    let resolved = false;
    let settleDone: (ok: boolean) => void;
    const done = new Promise<boolean>((r) => (settleDone = r));

    const onData = (d: Buffer) => {
      buf += d.toString();
      if (resolved) return;
      const clean = stripAnsi(buf);
      // URL: any https:// line (the fixed endpoint is auth.openai.com/codex/device)
      const urlMatch = clean.match(/https:\/\/\S+/);
      // Code: XXXX-XXXXX pattern (uppercase alphanum segments separated by dash)
      const codeMatch = clean.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4,6})\b/);
      if (urlMatch && codeMatch) {
        resolved = true;
        resolve({
          url: urlMatch[0],
          code: codeMatch[1],
          cancel() { child.kill(); },
          done,
        });
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    child.on("error", (e) => {
      if (!resolved) reject(e);
      settleDone(false);
    });
    child.on("exit", (code) => {
      if (!resolved) reject(codexLoginStartupError(buf));
      settleDone(code === 0);
    });
  });
}

export async function saveCodexApiKey(key: string): Promise<void> {
  await ensureDir(tokensDir());
  const path = tokenFile("codex-key");
  // Unlink before write so the new file is always created with 0o600 — if the file
  // already existed with looser permissions a plain writeFile would not downgrade them.
  await rm(path, { force: true });
  await writeFile(path, JSON.stringify({ apiKey: key }), { mode: 0o600 });
}

export async function getCodexApiKey(): Promise<string | null> {
  try {
    const data = JSON.parse(await readFile(tokenFile("codex-key"), "utf8")) as { apiKey?: string };
    return data.apiKey || null;
  } catch {
    return null;
  }
}

export async function deleteCodexApiKey(): Promise<void> {
  await rm(tokenFile("codex-key"), { force: true });
}

export async function isCodexLoggedIn(codexBin = "codex"): Promise<boolean> {
  if (await getCodexApiKey()) return true;

  return new Promise((resolve) => {
    let out = "";
    const p = spawn(codexBin, ["login", "status"], { stdio: ["ignore", "pipe", "pipe"] });
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (out += d.toString()));
    p.on("error", () => resolve(false));
    p.on("exit", (code) => {
      // "Logged in using ChatGPT" / "Logged in using API key" = ok
      // "not logged in" / "logged out" = false
      resolve(code === 0 && /logged in|authenticated|api key/i.test(out) && !/not logged in|logged out|no auth|not authenticated/i.test(out));
    });
  });
}

export async function markCodexConnected(): Promise<void> {
  await ensureDir(tokensDir());
  await writeFile(tokenFile("codex"), JSON.stringify({ connected: true }), { mode: 0o600 });
}

export async function isCodexMarked(): Promise<boolean> {
  try {
    const data = JSON.parse(await readFile(tokenFile("codex"), "utf8")) as { connected?: boolean };
    return data.connected === true;
  } catch {
    return false;
  }
}

function runCodexAuthCommand(codexBin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = "";
    const p = spawn(codexBin, args, { stdio: ["ignore", "pipe", "pipe"] });
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (out += d.toString()));
    p.on("error", reject);
    p.on("exit", (code) => {
      if (code === 0 || /not logged in|logged out|no auth|not authenticated/i.test(out)) {
        resolve(out);
      } else {
        reject(new Error(stripAnsi(out).trim() || `codex ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
}

export async function logoutCodex(codexBin = "codex"): Promise<void> {
  await deleteCodexApiKey();
  await runCodexAuthCommand(codexBin, ["logout"]);
  await rm(tokenFile("codex"), { force: true });
}
