// Skill-origin registry — the ONE place that answers "where did this installed skill come
// from?". A SKILL.md on disk is identical whatever its source (a bought NFT skill and a
// bundled one carry the same file shape), so origin CANNOT be read from the file. This
// keeps a side manifest, ~/.agentnet/skills.json, recording every NFT-bought slug → its
// mint, so a surface can badge skills distinctly even though the files are indistinguishable.
//
// Classification (skillOrigin):
//   "bundled" — ships with the app (skill-shopping, make-skill). Never in the manifest.
//   "nft"     — bought from the marketplace; recorded here (with its mint) at install time.
//   "local"   — present in a skills dir but neither bundled nor recorded (user-dropped).
//
// Only the nft set is persisted: bundled is a fixed constant, local is "everything else".
// ingest/index.ts (installBought / remove) keeps this in step with the filesystem.

import { readFile, writeFile } from "node:fs/promises";
import { skillsManifestFile, ensureDir, rootDir } from "../core/paths.js";
import { PASSIVE_SKILL_SLUG } from "./passive.js";

/** The (forthcoming) bundled make-skill publish skill — the publish-flow analog of
 *  skill-shopping's buy flow. Declared here so it classifies as "bundled" the moment it
 *  lands, with no other change needed. */
export const MAKE_SKILL_SLUG = "make-skill";

/** Skills that ship with the app — built-in, not bought, shown distinctly in the UI. The
 *  ONE source of this set (skill-shopping reuses passive.ts's slug). */
export const BUNDLED_SKILLS: readonly string[] = [PASSIVE_SKILL_SLUG, MAKE_SKILL_SLUG];

export type SkillOrigin = "bundled" | "nft" | "local";

/** One NFT-bought skill's record. `mint` is its base58 mint address (the on-chain id — a
 *  surface can link to the asset or re-verify from it). `installedAt` is epoch ms. */
export interface NftSkillRecord {
  mint: string;
  installedAt: number;
}

export interface SkillManifest {
  version: 1;
  nft: Record<string, NftSkillRecord>; // slug → record
  // LEGACY, read-only: the pre-wallet-scoping disposed list. The disposed set is the
  // WALLET's preference (not a device fact about folders), so it moved to the wallet-scoped,
  // cloud-synced equipState.ts — which adopts a non-empty list from here once, on a wallet's
  // first read. Nothing writes this field anymore.
  disposed: string[];
}

/** Read the manifest; a missing/corrupt file reads as empty (best-effort, never throws). */
export async function readSkillManifest(): Promise<SkillManifest> {
  try {
    const parsed = JSON.parse(await readFile(skillsManifestFile(), "utf8")) as Partial<SkillManifest>;
    return { version: 1, nft: parsed.nft ?? {}, disposed: parsed.disposed ?? [] };
  } catch {
    return { version: 1, nft: {}, disposed: [] };
  }
}

async function writeSkillManifest(m: SkillManifest): Promise<void> {
  await ensureDir(rootDir());
  await writeFile(skillsManifestFile(), JSON.stringify(m, null, 2));
}

/** Record an NFT-bought skill (called by installBought). Keyed by slug; re-installing
 *  refreshes the mint/timestamp. Best-effort — a write failure must never block a buy. */
export async function recordNftSkill(slug: string, mint: string, installedAt = Date.now()): Promise<void> {
  try {
    const m = await readSkillManifest();
    m.nft[slug] = { mint, installedAt };
    await writeSkillManifest(m);
  } catch {
    /* best-effort: origin tracking is non-critical */
  }
}

/** Drop a slug from the NFT set (called by remove / un-equip). Best-effort. */
export async function forgetNftSkill(slug: string): Promise<void> {
  try {
    const m = await readSkillManifest();
    if (m.nft[slug]) {
      delete m.nft[slug];
      await writeSkillManifest(m);
    }
  } catch {
    /* best-effort */
  }
}

/** Classify one installed slug against a (pre-read) manifest. Bundled wins over a stale
 *  manifest entry — a bundled slug must never read as nft. */
export function skillOrigin(slug: string, manifest: SkillManifest): SkillOrigin {
  if (BUNDLED_SKILLS.includes(slug)) return "bundled";
  if (manifest.nft[slug]) return "nft";
  return "local";
}

/** A classified installed skill: its origin, and (nft only) the mint a surface can link to. */
export interface ClassifiedSkill {
  slug: string;
  origin: SkillOrigin;
  mint?: string;
}

/** Tag installed slugs (e.g. the dir names from scanning a skills dir) with their origin,
 *  reading the manifest once. This is the UI-facing entry: a surface lists the slugs, then
 *  badges each "bundled" / "nft" / "local" (and may link the mint). */
export async function classifySkills(slugs: string[]): Promise<ClassifiedSkill[]> {
  const m = await readSkillManifest();
  return slugs.map((slug) => {
    const origin = skillOrigin(slug, m);
    const mint = origin === "nft" ? (m.nft[slug]?.mint ?? undefined) : undefined;
    return mint ? { slug, origin, mint } : { slug, origin };
  });
}
