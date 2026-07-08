// Soul → Eliza characterfile (plans/soul-memory-portability.md §3C). Eliza is the one
// runtime whose persona is structured JSON, so this is the one genuinely lossy render:
// recognized sections map to their characterfile fields, and unrecognized sections
// concatenate into `lore` so nothing silently drops.
//
// The write is a MERGE, never a whole-file replace: a real character.json also carries
// plugins / settings / secrets that are none of the soul's business — we only own the
// persona fields. Inject-only v1 (Eliza's memories live in its DB; capture is a later
// layer, see plan §7).

import { readFile, writeFile } from "node:fs/promises";
import { parseSoul } from "../parse.js";

/** The characterfile fields the soul owns. Everything else in an existing file is
 *  preserved verbatim by the merge. */
export interface ElizaPersona {
  name: string;
  bio: string[];
  lore: string[];
  style: { all: string[]; chat: string[]; post: string[] };
  /** Boundaries render as the system prompt — behavioral constraints, not flavor. */
  system?: string;
}

export function soulToElizaPersona(soulText: string, fallbackName = "agentnet-agent"): ElizaPersona {
  const p = parseSoul(soulText);
  const extraLore = p.extras
    .filter((s) => s.body)
    .map((s) => (s.heading ? `${s.heading}: ${s.body}` : s.body))
    .flatMap((t) => t.split("\n").map((l) => l.trim()).filter(Boolean));
  return {
    name: p.name ?? fallbackName,
    bio: p.bio,
    lore: [...p.lore, ...extraLore],
    style: { all: p.style, chat: [], post: [] },
    ...(p.boundaries.length ? { system: p.boundaries.join(" ") } : {}),
  };
}

/**
 * Merge the soul-derived persona into a character.json on disk. Existing file: only
 * the persona fields are replaced (plugins/settings/clients/etc. untouched). Missing
 * file: a minimal character is created around the persona.
 */
export async function writeElizaCharacter(file: string, soulText: string): Promise<void> {
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  } catch {
    /* no character file yet, or unparseable — start from the persona alone */
  }
  const persona = soulToElizaPersona(soulText, (existing.name as string) || undefined);
  await writeFile(file, JSON.stringify({ ...existing, ...persona }, null, 2) + "\n");
}
