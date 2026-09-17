// Engine version report + trusted updater. The whole point is that surfaces never show
// the user an external "download here" link (stale CLIs and search results routinely
// point at lookalike/phishing sites); the installed version comes from the binary itself,
// the latest version comes from the official npm registry, and the update runs the
// engine's own updater, or the official npm command when the engine is missing. All
// host-side, on an explicit user tap.

import { spawnEngine as spawn } from "./engineProcess.js";
import { basename } from "node:path";
import { ENGINE_UPDATE_COMMAND } from "./engineInstall.js";
import { resolveEngineBin, type EngineName } from "./engineBin.js";
export { isVersionOlder } from "./engineInstall.js";

export type { EngineName };

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

function tail(text: string): string {
  return text.trim().split("\n").slice(-3).join("\n"); // 3 lines fit a toast
}

// One command to completion, resolved on close, not exit: exit can fire before stdout is
// drained. Stdout on exit 0; otherwise the tail of stderr, or of stdout when stderr is
// empty (claude's updater explains itself on stdout), or the basename and the code.
function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(tail(err) || tail(out) || `${basename(cmd)} exited with code ${code}`));
    });
  });
}

function installedVersion(engine: EngineName): Promise<string | null> {
  return run(resolveEngineBin(engine), ["--version"]).then(firstSemver, () => null);
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

// An installed engine updates itself (claude update, codex update; each picks npm, brew or
// its own installer). One that declines can still exit 0 (claude under Homebrew prints the
// brew command), so the version is read before and after; unchanged is fine only when the
// updater says it is already up to date. A missing engine gets the npm command.
export async function updateEngine(engine: EngineName): Promise<void> {
  const bin = resolveEngineBin(engine);
  if (bin === engine) {
    const [cmd, ...args] = ENGINE_UPDATE_COMMAND[engine].split(" ");
    await run(cmd, args);
    return;
  }
  const before = await installedVersion(engine);
  const said = await run(bin, ["update"]);
  if ((await installedVersion(engine)) !== before || /up.to.date|latest/i.test(said)) return;
  throw new Error(tail(said) || `${basename(bin)} update left ${before ?? "the version"} unchanged`);
}
