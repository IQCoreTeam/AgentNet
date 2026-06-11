import { readFile, writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

// Small CLI-local prefs file (separate from core's storage config). Remembers that the
// user finished first-run setup — so we DON'T re-onboard every launch (the "local only"
// path writes no storage config, which previously left isInitialized() false forever) —
// plus the last engine/model/session for a friendly resume.
export interface Prefs {
  onboarded?: boolean;
  lastCli?: "claude" | "codex";
  lastModel?: string;
  lastSessionId?: string;
  calm?: boolean; // remembered animation preference
}

const prefsFile = () => join(homedir(), ".agentnet", "cli.json");

export async function readPrefs(): Promise<Prefs> {
  try {
    return JSON.parse(await readFile(prefsFile(), "utf8")) as Prefs;
  } catch {
    return {};
  }
}

// sync read for the launch path (DelightProvider needs the calm flag before first render).
export function readPrefsSync(): Prefs {
  try {
    return JSON.parse(readFileSync(prefsFile(), "utf8")) as Prefs;
  } catch {
    return {};
  }
}

// merge-write: callers pass only the keys they're changing.
export async function savePrefs(patch: Partial<Prefs>): Promise<void> {
  const cur = await readPrefs();
  const next = { ...cur, ...patch };
  try {
    await mkdir(dirname(prefsFile()), { recursive: true });
    await writeFile(prefsFile(), JSON.stringify(next, null, 2));
  } catch {
    /* best-effort: a prefs write failure must never break the session */
  }
}
