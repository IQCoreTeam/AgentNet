// Active-skill injection (issue #17) — the skill analog of MemorySync.injectAtStart,
// but read-only (skills are public on-chain content, so no encryption and no capture
// direction). It writes a bought skill's SKILL.md into the CLI's skills dir so the
// runtime discovers it and loads the body on demand (last30days pattern — see
// plans/skill-ingestion.md §3, §8a).
//
// Trigger THIS PR: "I bought a skill in the marketplace" → installBought(). Reading a
// wallet's whole owned set at session start, the agent's own search-and-buy, and the
// passive verify gate are deliberately out of scope (next PR).

import { access, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Connection } from "@solana/web3.js";
import { claudeSkillsDir, codexSkillsDir, ensureDir } from "../../core/paths.js";
import { readSkillMintMetadata } from "../../nft/token2022.js";
import { ownedSkillMints } from "../../core/skillSource.js";
import { recordNftSkill, forgetNftSkill } from "../registry.js";
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
    // Record origin: this slug came from an NFT (its mint). The SKILL.md itself can't say
    // so — the registry is what lets a surface badge it as bought vs bundled vs local.
    // Best-effort (recordNftSkill swallows its own errors) so it never blocks the install.
    await recordNftSkill(slug, skillMint);
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

  /**
   * Install ALL skills a wallet owns into a runtime's skills dir (issue #17) — the
   * "session-start load" + "re-load after a buy" path, mirroring how last30days is
   * present before the session uses it. Enumerates owned skill NFTs (DAS), then writes
   * each one's SKILL.md. Best-effort: a single bad mint is skipped, not fatal. Returns
   * the slugs installed. No RPC / no owned mints → installs nothing.
   */
  async injectOwned(cli: Cli, owner: string): Promise<string[]> {
    const mints = await ownedSkillMints(owner);
    const slugs = await Promise.all(
      mints.map((m) => this.installBought(cli, m).catch(() => null)),
    );
    return slugs.filter((s): s is string => !!s);
  }

  /** Remove an installed skill from a runtime's skills dir (e.g. on un-equip). The origin
   *  record (per-device, not per-runtime) is dropped only once the slug is gone from BOTH
   *  runtimes — otherwise a surviving copy in the other runtime would misread as "local". */
  async remove(cli: Cli, slug: string): Promise<void> {
    await rm(join(skillsDir(cli), slug), { recursive: true, force: true });
    const stillInstalled = await Promise.all(
      (["claude", "codex"] as Cli[]).map((c) =>
        access(join(skillsDir(c), slug)).then(() => true).catch(() => false),
      ),
    );
    if (!stillInstalled.some(Boolean)) await forgetNftSkill(slug);
  }
}
