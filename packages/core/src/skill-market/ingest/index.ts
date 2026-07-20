// Active-skill injection (issue #17) — the skill analog of MemorySync.injectAtStart,
// but read-only (skills are public on-chain content, so no encryption and no capture
// direction). It writes a bought skill's SKILL.md into the CLI's skills dir so the
// runtime discovers it and loads the body on demand (last30days pattern — see
// plans/skill-ingestion.md §3, §8a).
//
// buyAndEquip() is the shared "buy on-chain + equip locally" path used by BOTH the human
// marketplace UI (marketplaceEnv.buySkill) and the agent's buy_skill MCP tool, so a
// purchase equips identically however it was triggered.

import { access, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Connection } from "@solana/web3.js";
import type { SignerInput } from "@iqlabs-official/solana-sdk/utils";
import {
  claudeSkillsDir,
  codexSkillsDir,
  inactiveSkillsDir,
  ensureDir,
  hermesHome,
  hermesSkillsDir,
  openclawHome,
  openclawSkillsDir,
  extraSkillDirs,
} from "../../core/paths.js";
import { readSkillMintMetadata } from "../../nft/token2022.js";
import { ownedSkillMints, cachedCatalog } from "../../core/skillSource.js";
import { buySkill } from "../../nft/skill.js";
import { signerAddress } from "../../core/chain.js";
import { invalidateHeldMints, heldSkillMints } from "../../notes/holdings.js";
import {
  recordNftSkill,
  forgetNftSkill,
  readSkillManifest,
  BUNDLED_SKILLS,
} from "../registry.js";
import { readDisposed, disposeMint, undisposeMint } from "../equipState.js";
import { toSkillMd, skillSlug, slugifyName, skillBodyKey } from "./convert.js";

export type Cli = "claude" | "codex";

function skillsDir(cli: Cli): string {
  return cli === "claude" ? claudeSkillsDir() : codexSkillsDir();
}

/**
 * Skills dirs of FOREIGN runtimes present on this machine (issue #84 §B piece 2). We
 * never spawn these engines, so they stay out of the Cli union — they're install
 * targets only. A known host counts as present when its home dir exists (it's the host
 * that spawned our stdio server, or the user runs it here); AGENTNET_SKILL_DIRS adds
 * arbitrary dirs for hosts without a fixed convention (e.g. Eliza).
 */
export async function externalSkillDirs(): Promise<string[]> {
  const present = async (home: string, dir: string) =>
    (await access(home).then(() => true).catch(() => false)) ? [dir] : [];
  const [hermes, openclaw] = await Promise.all([
    present(hermesHome(), hermesSkillsDir()),
    present(openclawHome(), openclawSkillsDir()),
  ]);
  return [...hermes, ...openclaw, ...extraSkillDirs()];
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
    return this.installBoughtToDir(skillsDir(cli), skillMint);
  }

  /**
   * Path-based install core: same render + registry record as installBought, but the
   * target is ANY skills dir — a foreign host's (~/.hermes/skills, ~/.openclaw/skills)
   * or one passed by the install_skill tool. Kept public so external-host flows don't
   * have to widen the Cli union (issue #84).
   */
  async installBoughtToDir(targetDir: string, skillMint: string): Promise<string | null> {
    const meta = await readSkillMintMetadata(this.conn, skillMint);
    if (!meta) return null;
    const slug = skillSlug(meta, skillMint);
    const dir = join(targetDir, slug);
    await ensureDir(dir);
    // A workflow (requiredSkills non-empty) names its constituent skills in the SKILL.md so
    // the agent knows it orchestrates them; a plain skill skips this entirely (no RPC cost).
    const reqNames = await this.requiredSkillNames(meta.requiredSkills);
    await writeFile(join(dir, "SKILL.md"), toSkillMd(meta, skillMint, reqNames));
    // Record origin: this slug came from an NFT (its mint). The SKILL.md itself can't say
    // so — the registry is what lets a surface badge it as bought vs bundled vs local.
    // Best-effort (recordNftSkill swallows its own errors) so it never blocks the install.
    await recordNftSkill(slug, skillMint);
    return slug;
  }

  /** Resolve a workflow's required-skill mints to display names for its SKILL.md note.
   *  Best-effort per mint (a name we can't read falls back to a short mint id), and a
   *  no-op for plain skills (no required skills → undefined, so toSkillMd stays unchanged). */
  private async requiredSkillNames(reqs: string[] | undefined): Promise<string[] | undefined> {
    if (!reqs || reqs.length === 0) return undefined;
    return Promise.all(
      reqs.map(async (m) => {
        const md = await readSkillMintMetadata(this.conn, m).catch(() => null);
        return md?.name || `skill ${m.slice(0, 8)}`;
      }),
    );
  }

  /** Install a bought skill into BOTH runtimes' skills dirs (the buyer may use either),
   *  plus every foreign host present on this machine (best-effort — a foreign-dir hiccup
   *  never fails the claude/codex install). */
  async installBoughtAll(skillMint: string): Promise<string | null> {
    const external = await externalSkillDirs().catch(() => [] as string[]);
    const [slug] = await Promise.all([
      this.installBought("claude", skillMint),
      this.installBought("codex", skillMint),
      ...external.map((d) => this.installBoughtToDir(d, skillMint).catch(() => null)),
    ]);
    return slug;
  }

  /**
   * Buy a skill on-chain AND equip it (write its SKILL.md into both runtimes' skills dirs)
   * in one call — the single source of truth for "a purchase = owned + usable now". Shared
   * by the human marketplace UI and the agent's buy_skill MCP tool so both paths equip
   * identically. Returns the buy tx signature and the installed slug (slug is null when the
   * mint has no readable metadata to install — the on-chain purchase still succeeded).
   */
  async buyAndEquip(
    signer: SignerInput,
    skillId: string,
    creatorWallet: string,
  ): Promise<{ txSig: string; slug: string | null }> {
    const buyerWallet = await signerAddress(signer);
    // Refuse to re-buy a skill the wallet already holds: tokens are soulbound (no
    // transfer, no refund), so a second buy is pure SOL loss — and every buy path
    // (UI modal, agent tool, mobile) funnels through here, so this is the one floor
    // that catches a stale "Buy" button anywhere. Best-effort: no DAS → can't check
    // → proceed (same availability trade injectOwned makes).
    const alreadyOwned = await ownedSkillMints(buyerWallet).catch(() => null);
    if (alreadyOwned && alreadyOwned.includes(skillId)) {
      throw new Error(
        "You already own this skill (soulbound, held in your wallet). Re-equip it instead of buying again.",
      );
    }
    // A workflow gates on required skills: buy_item needs the buyer's ATA for each, passed
    // in the config's order. Read them from the mint metadata (publish order = config order).
    // A plain skill has none, so this is a no-op gate there.
    const requiredSkills = (await readSkillMintMetadata(this.conn, skillId).catch(() => null))?.requiredSkills;
    const txSig = await buySkill(this.conn, signer, { skillId, buyerWallet, creatorWallet, requiredSkills });
    // The buyer now holds a new skill token — drop the cached holdings so the comment
    // gate (heldSkillMints) sees it immediately instead of after the TTL.
    invalidateHeldMints(buyerWallet);
    // Equip is best-effort: the purchase already landed on-chain (irreversible), so a
    // content/fs hiccup during install must NOT surface as a failed buy — that could
    // prompt a costly re-buy. slug=null just means "owned, equips on the next owned-sync".
    const slug = await this.installBoughtAll(skillId).catch(() => null);
    return { txSig, slug };
  }

  /**
   * Install ALL skills a wallet owns into a runtime's skills dir (issue #17) — the
   * "session-start load" + "re-load after a buy" path, mirroring how last30days is
   * present before the session uses it. Enumerates owned skill NFTs (DAS), then writes
   * each one's SKILL.md. Best-effort: a single bad mint is skipped, not fatal. Returns
   * the slugs installed. No RPC / no owned mints → installs nothing.
   */
  async injectOwned(cli: Cli, owner: string): Promise<string[]> {
    // ONE holdings read powers install AND reconcile: heldSkillMints is the cached
    // retry+last-good wrapper around the same getTokenAccountsByOwner call
    // ownedSkillMints would make itself, so passing the set through adds zero RPC.
    // null = the read failed every attempt with no last-good fallback — install still
    // proceeds (ownedSkillMints does its own read, preserving old behavior) but
    // reconcile is SKIPPED: never prune on a read we can't trust.
    const held = await heldSkillMints(owner).catch(() => null);
    const mints = await ownedSkillMints(owner, undefined, held ?? undefined);
    // Skip skills the wallet deliberately disposed: they're still owned on-chain (soulbound,
    // no refund) so they'd reappear here every session — the wallet-synced disposed list is
    // what makes a dispose stick across devices. Re-equipping clears the mint from it.
    const disposed = await readDisposed(owner).catch(() => new Set<string>());
    const keep = mints.filter((m) => !disposed.has(m));
    const slugs = await Promise.all(
      keep.map((m) => this.installBought(cli, m).catch(() => null)),
    );
    if (held) await this.reconcile(cli, held, disposed).catch(() => {});
    return slugs.filter((s): s is string => !!s);
  }

  /**
   * Make the skills dir agree with chain truth (runs on every owned-sync, i.e. on
   * connect / session start / after a buy — the moments a skill is about to be used).
   * The dir is a MATERIALIZATION of on-chain ownership plus the wallet's synced
   * un-equip choice, so anything that contradicts those moves OUT to the holding dir
   * (never deleted — a wrong move self-heals on the next sync, which reinstalls
   * anything genuinely owned):
   *
   *   nft-origin folder whose mint this wallet doesn't hold  → out. Covers another
   *     wallet's leftovers, devnet leftovers after the mainnet flip, and a forged
   *     manifest entry (a mint written by hand is not in the wallet).
   *   nft-origin folder whose mint is disposed               → out. A dispose made on
   *     another device lands here via the synced equip state.
   *   local folder that verbatim-copies an unowned paid skill → out (quarantinePirated).
   *
   * Everything else local is the user's own work and is never touched.
   */
  private async reconcile(cli: Cli, held: Set<string>, disposed: Set<string>): Promise<void> {
    const entries = await readdir(skillsDir(cli), { withFileTypes: true }).catch(() => []);
    const manifest = await readSkillManifest();
    for (const e of entries) {
      if (!e.isDirectory() || BUNDLED_SKILLS.includes(e.name)) continue;
      const rec = manifest.nft[e.name];
      if (rec) {
        if (!held.has(rec.mint) || disposed.has(rec.mint)) {
          await this.moveSkill(cli, e.name, "out").catch(() => false);
        }
      } else {
        await this.quarantinePirated(cli, e.name, held).catch(() => {});
      }
    }
  }

  /** The "make piracy annoying" floor (not a hard lock): a local-origin slug that
   *  collides with a catalog item the wallet does NOT own is fetched once and compared
   *  by content — a verbatim copy is moved to the holding dir. Name-only collisions
   *  (someone legitimately reusing a name) never match on content and stay untouched.
   *  Costs nothing until a collision actually happens: the catalog is the 30s-cached
   *  list the owned-sync already fetched, and the metadata read fires only on collision. */
  private async quarantinePirated(cli: Cli, slug: string, held: Set<string>): Promise<void> {
    const item = (await cachedCatalog())?.find((c) => slugifyName(c.name) === slug && !held.has(c.id));
    if (!item) return;
    const local = await readFile(join(skillsDir(cli), slug, "SKILL.md"), "utf8").catch(() => null);
    if (!local) return;
    const meta = await readSkillMintMetadata(this.conn, item.id).catch(() => null);
    if (!meta) return;
    const key = skillBodyKey(local);
    if (key && key === skillBodyKey(toSkillMd(meta, item.id))) {
      await this.moveSkill(cli, slug, "out");
    }
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

  /** Move one slug's folder between a runtime's scanned dir and its un-scanned holding dir
   *  (same mechanism skill-shopping's toggle uses). dir:"out" = active→holding (un-equip),
   *  dir:"in" = holding→active (re-equip). Never deletes — a disposed skill is kept, just
   *  hidden from the CLI. Returns true if a folder was actually moved. */
  private async moveSkill(cli: Cli, slug: string, dir: "out" | "in"): Promise<boolean> {
    const activeDir = join(skillsDir(cli), slug);
    const heldDir = join(inactiveSkillsDir(cli), slug);
    const [from, to, toRoot] =
      dir === "out" ? [activeDir, heldDir, inactiveSkillsDir(cli)] : [heldDir, activeDir, skillsDir(cli)];
    if (!(await access(from).then(() => true).catch(() => false))) return false;
    await ensureDir(toRoot);
    await rm(to, { recursive: true, force: true }); // replace any stale copy on the target side
    await rename(from, to);
    return true;
  }

  /** Resolve a mint's on-disk slug: prefer the origin manifest (recorded at install), else
   *  derive it from the mint's on-chain metadata (the same fn install used). */
  private async slugForMint(mint: string): Promise<string | null> {
    const manifest = await readSkillManifest().catch(() => null);
    const recorded = manifest
      ? (Object.keys(manifest.nft).find((s) => manifest.nft[s].mint === mint) ?? null)
      : null;
    if (recorded) return recorded;
    const meta = await readSkillMintMetadata(this.conn, mint).catch(() => null);
    return meta ? skillSlug(meta, mint) : null;
  }

  /**
   * Un-equip a skill the wallet owns but no longer wants — the inverse of
   * buyAndEquip, shared by the unequip_skill MCP tool and the UI. Soulbound tokens can't be
   * sold or burned, so this is a local "un-pin", NOT a delete: MOVE the SKILL.md out of both
   * runtimes' scanned dirs into the holding dir (so the CLI stops loading it) and record the
   * mint as disposed (so the session-start owned-sync doesn't re-add it, and the UI greys it
   * out). The wallet still owns the NFT; re-equip restores it instantly. Returns the slug.
   */
  async dispose(skillMint: string, owner: string): Promise<string | null> {
    const slug = await this.slugForMint(skillMint);
    if (slug) {
      await this.moveSkill("claude", slug, "out").catch(() => false);
      await this.moveSkill("codex", slug, "out").catch(() => false);
      // Foreign hosts get a plain delete, not the holding-dir move: their copy is fully
      // regenerable from chain (re-equip reinstalls it), so no held copy is needed.
      const external = await externalSkillDirs().catch(() => [] as string[]);
      await Promise.all(
        external.map((d) => rm(join(d, slug), { recursive: true, force: true }).catch(() => {})),
      );
    }
    // Record the mint in the wallet's synced equip state (survives a slug rename; the key
    // injectOwned + the UI grey-out check, and it follows the wallet to other devices).
    await disposeMint(owner, skillMint);
    return slug;
  }

  /**
   * Re-equip a previously-disposed skill the wallet still owns (undo an un-pin): clear the
   * disposed mark and MOVE the held folder back into both scanned dirs. If no held copy
   * exists (disposed on another device, or never installed here), reinstall from chain so
   * re-equip still works. Returns the slug.
   */
  async reEquip(skillMint: string, owner: string): Promise<string | null> {
    await undisposeMint(owner, skillMint);
    const slug = await this.slugForMint(skillMint);
    let restored = false;
    if (slug) {
      const a = await this.moveSkill("claude", slug, "in").catch(() => false);
      const b = await this.moveSkill("codex", slug, "in").catch(() => false);
      restored = a || b;
    }
    if (!restored) return this.installBoughtAll(skillMint); // nothing held → pull from chain
    // Held copies only exist for claude/codex (dispose deletes foreign copies outright),
    // so a restore must still reinstall the foreign dirs from chain. Best-effort.
    const external = await externalSkillDirs().catch(() => [] as string[]);
    await Promise.all(external.map((d) => this.installBoughtToDir(d, skillMint).catch(() => null)));
    return slug;
  }
}
