// Engine version report + trusted updater. The whole point is that surfaces never show
// the user an external "download here" link (stale CLIs and search results routinely
// point at lookalike/phishing sites); the installed version comes from the binary itself,
// the latest version comes from the official npm registry, and the update runs the same
// official npm command the install docs use — all host-side, on an explicit user tap.

import { spawn } from "node:child_process";
import { ENGINE_UPDATE_COMMAND } from "./engineInstall.js";
export { isVersionOlder } from "./engineInstall.js";

export type EngineName = "claude" | "codex";

// npm package per engine — the single trusted distribution channel for both CLIs.
const ENGINE_PACKAGE: Record<EngineName, string> = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
};

export interface EngineVersionInfo {
  installed: string | null; // null = binary missing or version unparseable
  latest: string | null; // null = registry unreachable
}

const SEMVER = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/;

function firstSemver(text: string): string | null {
  return text.match(SEMVER)?.[0] ?? null;
}

function installedVersion(bin: EngineName): Promise<string | null> {
  return new Promise((resolve) => {
    let out = "";
    const p = spawn(bin, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (out += d.toString()));
    p.on("error", () => resolve(null));
    p.on("exit", () => resolve(firstSemver(out)));
  });
}

async function latestVersion(engine: EngineName): Promise<string | null> {
  const pkg = ENGINE_PACKAGE[engine].replace("/", "%2F");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 7000);
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, { signal: ctl.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: string };
    return typeof body.version === "string" ? firstSemver(body.version) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getEngineVersions(): Promise<Record<EngineName, EngineVersionInfo>> {
  const [ci, cl, xi, xl] = await Promise.all([
    installedVersion("claude"),
    latestVersion("claude"),
    installedVersion("codex"),
    latestVersion("codex"),
  ]);
  return {
    claude: { installed: ci, latest: cl },
    codex: { installed: xi, latest: xl },
  };
}

// Run the official npm update command for one engine. Resolves on success, rejects with
// the stderr tail on failure so the surface can show a real reason.
export function updateEngine(engine: EngineName): Promise<void> {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = ENGINE_UPDATE_COMMAND[engine].split(" ");
    let err = "";
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", (e) => reject(new Error(e.message)));
    p.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim().split("\n").slice(-3).join("\n") || `npm exited with code ${code}`));
    });
  });
}
