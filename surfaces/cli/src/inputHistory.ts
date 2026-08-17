import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

// Persistent composer history, shell-style: everything the user SENDS (messages,
// slash commands, ! bash lines) lands in one file, so a fresh session's up-arrow
// recalls prior sessions' inputs the way codex does. This is a surface concern -
// what was TYPED into this composer, across engines and sessions - so it lives
// beside cli.json in the CLI's own config home, not in core's session store
// (those are per-session, wallet-encrypted blobs on whichever storage backend is
// connected; recalling keystrokes must not depend on decrypting session logs).
//
// Shape: a JSON array of strings, oldest first / newest last - JSON escaping keeps
// multi-line inputs intact on one of the file's lines. Capped at the newest
// HISTORY_CAP entries. The composer's recall walks it newest-first from the end.

export const HISTORY_CAP = 1000;

// Same root ~/.agentnet dir cli.json uses; AGENTNET_HOME overrides it exactly as
// core/paths.ts documents for every other file under that root (lets probes and
// multi-account setups point elsewhere).
const historyFile = () =>
  join(process.env.AGENTNET_HOME || join(homedir(), ".agentnet"), "input-history.json");

// Sync read for boot: Chat seeds its history state in a useState initializer, the
// same pattern readPrefsSync serves for DelightProvider.
export function loadInputHistory(): string[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(historyFile(), "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is string => typeof e === "string" && e.length > 0)
      .slice(-HISTORY_CAP);
  } catch {
    return []; // no file yet / unreadable / corrupt: start empty, never break boot
  }
}

// Append one sent input. Empty strings never stored; a resend identical to the
// newest stored entry is skipped (consecutive dedupe, like HISTIGNORE dups).
// Read-modify-write keeps the file a plain capped array with no index to corrupt.
// 0o600 like the token files: recalled inputs are the user's own prompts.
export async function appendInputHistory(entry: string): Promise<void> {
  if (!entry) return;
  const cur = loadInputHistory();
  if (cur[cur.length - 1] === entry) return;
  cur.push(entry);
  try {
    await mkdir(dirname(historyFile()), { recursive: true, mode: 0o700 });
    await writeFile(historyFile(), JSON.stringify(cur.slice(-HISTORY_CAP), null, 2), {
      mode: 0o600,
    });
  } catch {
    /* best-effort: a history write failure must never break the send */
  }
}

// Merge history sources into one recall list, oldest first / newest last, no
// duplicates: when the same text appears in more than one source (a persisted
// entry retyped this session, a resumed transcript message already on disk) the
// LATEST occurrence keeps its position, so up-arrow order stays session-local
// newest first. Pure; the composer's histPos state machine consumes the result
// unchanged.
export function mergeHistory(...sources: string[][]): string[] {
  const all = sources.flat().filter((e) => e.length > 0);
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = all.length - 1; i >= 0; i--) {
    if (!seen.has(all[i])) {
      seen.add(all[i]);
      out.unshift(all[i]);
    }
  }
  return out;
}
