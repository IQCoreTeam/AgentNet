// canonicalId -> native CLI id map, for cross-CLI resume.
//
// A canonical session is born in ONE cli, so its canonicalId == that cli's
// native id. To resume it in the OTHER cli we must mint a fresh native id for
// that cli (claude wants a uuid filename, codex a threadId), inject the history
// under it, and remember the pairing so later turns reuse the same native thread.
//
// This map is DEVICE-LOCAL (native ids only exist in ~/.claude / ~/.codex on this
// machine) and recomputable — losing it just re-mints + re-injects. So it lives
// next to the other per-device state as plain JSON, NOT in the synced canonical log.

import { readFile, writeFile } from "node:fs/promises";
import { cliMapFile, ensureDir, rootDir } from "../../core/paths.js";

type Cli = "claude" | "codex";
type Map = Record<string, Partial<Record<Cli, string>>>;

async function read(): Promise<Map> {
  try {
    return JSON.parse(await readFile(cliMapFile(), "utf8")) as Map;
  } catch {
    return {}; // missing/corrupt -> empty; ids get re-minted
  }
}

export async function getNativeId(canonicalId: string, cli: Cli): Promise<string | undefined> {
  return (await read())[canonicalId]?.[cli];
}

export async function setNativeId(canonicalId: string, cli: Cli, nativeId: string): Promise<void> {
  const map = await read();
  (map[canonicalId] ??= {})[cli] = nativeId;
  await ensureDir(rootDir());
  await writeFile(cliMapFile(), JSON.stringify(map, null, 2));
}
