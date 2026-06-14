// Active-skill injection (issue #17) — the skill analog of MemorySync.injectAtStart,
// but read-only (skills are public on-chain content, so no encryption and no capture
// direction). It writes a bought skill's SKILL.md into the CLI's skills dir so the
// runtime discovers it and loads the body on demand (last30days pattern — see
// plans/skill-ingestion.md §3, §8a).
//
// Trigger THIS PR: "I bought a skill in the marketplace" → installBought(). Reading a
// wallet's whole owned set at session start, the agent's own search-and-buy, and the
// passive verify gate are deliberately out of scope (next PR).

import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Connection } from "@solana/web3.js";
import { claudeSkillsDir, codexSkillsDir, ensureDir } from "../../core/paths.js";
import { readSkillMintMetadata } from "../../nft/token2022.js";
import { toSkillMd, skillSlug } from "./convert.js";

export type Cli = "claude" | "codex";

function skillsDir(cli: Cli): string {
  return cli === "claude" ? claudeSkillsDir() : codexSkillsDir();
}

export class SkillSync {
  constructor(private conn: Connection) {}

  /**
   * Install a just-bought skill into a runtime's skills dir so it's discoverable next
   * session: read the mint's on-chain metadata, render SKILL.md, write
   * {skillsDir}/{slug}/SKILL.md. Returns the slug it installed under, or null if the
   * mint has no readable metadata (nothing to write). Best-effort by design — callers
   * wrap it so a content hiccup never blocks the purchase from completing.
   */
  async installBought(cli: Cli, skillMint: string): Promise<string | null> {
    const meta = await readSkillMintMetadata(this.conn, skillMint);
    if (!meta) return null;
    const slug = skillSlug(meta, skillMint);
    const dir = join(skillsDir(cli), slug);
    await ensureDir(dir);
    await writeFile(join(dir, "SKILL.md"), toSkillMd(meta, skillMint));
    return slug;
  }

  /** Install a bought skill into BOTH runtimes' skills dirs (the buyer may use either). */
  async installBoughtAll(skillMint: string): Promise<string | null> {
    const [slug] = await Promise.all([
      this.installBought("claude", skillMint),
      this.installBought("codex", skillMint),
    ]);
    return slug;
  }

  /** Remove an installed skill from a runtime's skills dir (e.g. on un-equip). */
  async remove(cli: Cli, slug: string): Promise<void> {
    await rm(join(skillsDir(cli), slug), { recursive: true, force: true });
  }
}
