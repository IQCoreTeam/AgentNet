import { readFile, writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { coerceEngineKey, type EngineKey } from "@iqlabs-official/agent-sdk";

// Small CLI-local prefs file (separate from core's storage config). Remembers that the
// user finished first-run setup — so we DON'T re-onboard every launch (the "local only"
// path writes no storage config, which previously left isInitialized() false forever) —
// plus the last engine/model/session for a friendly resume.
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface Prefs {
  onboarded?: boolean;
  lastCli?: EngineKey;
  // per-engine: a claude model id (e.g. "sonnet") is meaningless to codex's API and vice
  // versa, so each engine remembers its own last model rather than sharing one field.
  lastModelClaude?: string;
  lastModelCodex?: string;
  lastModelCustom?: string;
  lastSessionId?: string;
  lastEffort?: EffortLevel;
  calm?: boolean; // remembered animation preference
}

// Which per-engine field holds an engine's last model: one lookup shared by the read
// side (restore on switch/launch) and the write side (remember on change).
export const LAST_MODEL_PREF = {
  claude: "lastModelClaude",
  codex: "lastModelCodex",
  custom: "lastModelCustom",
} as const satisfies Record<EngineKey, keyof Prefs>;

const prefsFile = () => join(homedir(), ".agentnet", "cli.json");

// The prefs file is hand-editable and may have been written by a newer build, so lastCli
// can hold a string outside this build's EngineKey union. Coercing it on every read path
// keeps registry lookups downstream (engineBinary, LAST_MODEL_PREF) from crashing boot.
function coerceRead(p: Prefs): Prefs {
  return p.lastCli ? { ...p, lastCli: coerceEngineKey(p.lastCli) } : p;
}

export async function readPrefs(): Promise<Prefs> {
  try {
    return coerceRead(JSON.parse(await readFile(prefsFile(), "utf8")) as Prefs);
  } catch {
    return {};
  }
}

// sync read for the launch path (DelightProvider needs the calm flag before first render).
export function readPrefsSync(): Prefs {
  try {
    return coerceRead(JSON.parse(readFileSync(prefsFile(), "utf8")) as Prefs);
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
