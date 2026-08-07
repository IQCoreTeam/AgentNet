// Self-update notice, same trust rules as the engine updater (engineVersions.ts): the
// installed version comes from our own package.json, the latest from the official npm
// registry, and the guidance is the exact npm command. Best-effort and non-blocking:
// registry down or offline simply means no notice.
import { readFile } from "node:fs/promises";
import { isVersionOlder } from "@iqlabs-official/agent-sdk";

export const CLI_PACKAGE = "@iqlabs-official/agentnet-cli";
export const CLI_UPDATE_COMMAND = `npm install -g ${CLI_PACKAGE}@latest`;

// package.json sits one level above both src/ (tsx dev) and dist/ (bundle + npm install).
export async function installedCliVersion(): Promise<string | null> {
  try {
    const raw = await readFile(new URL("../package.json", import.meta.url), "utf8");
    const v = (JSON.parse(raw) as { version?: string }).version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

async function latestCliVersion(): Promise<string | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const res = await fetch(`https://registry.npmjs.org/${CLI_PACKAGE.replace("/", "%2F")}/latest`, {
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: string };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// null = up to date (or unknowable right now).
export async function checkCliUpdate(): Promise<{ installed: string; latest: string } | null> {
  const [installed, latest] = await Promise.all([installedCliVersion(), latestCliVersion()]);
  if (!installed || !latest) return null;
  return isVersionOlder(installed, latest) ? { installed, latest } : null;
}
