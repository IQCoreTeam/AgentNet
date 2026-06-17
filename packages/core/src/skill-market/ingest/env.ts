// Marketplace env helper (issue #17) — bundles the three host-delegated chat callbacks
// (searchSkills / buySkill / ownedSkills) so a surface wires the market with one call
// instead of re-deriving a connection + signer itself. The chain connection comes from
// the same RPC env dasSource already uses, keeping one source of truth for the RPC.
//
// buySkill is the whole "user buys in the marketplace" flow for this PR: purchase the
// soulbound token, then install the bought skill's SKILL.md into BOTH runtimes' skills
// dirs (SkillSync) so it's discovered next session — search/buy were built yesterday,
// this is the wiring that makes a purchase actually equip the skill.

import { Connection } from "@solana/web3.js";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Wallet } from "../../runtime/contract.js";
import { searchSkills } from "../../search/index.js";
import { dasSource, indexerSource, ownedSkillMints, ownedAssetIds } from "../../core/skillSource.js";
import { buySkill, publishSkill as corePublishSkill } from "../../nft/skill.js";
import { getSolBalance } from "../../notes/index.js";
import { readSkillText, readSkillMintMetadata } from "../../nft/token2022.js";
import { claudeSkillsDir } from "../../core/paths.js";
import { classifySkills } from "../registry.js";
import { resolveRpcUrl } from "../../core/rpc.js";
import { init as initChain } from "../../core/chain.js";
import type { AgentProfile, SkillCard, SkillDetail } from "../../chat/marketMessages.js";
import type { Skill } from "../../core/types.js";
import { readNotes, postNote as corePostNote, readAgentNotes, postAgentNote as corePostAgentNote } from "../../notes/notes.js";
import { getSkillsCollectionMint, getWorkflowsCollectionMint, getIndexerUrl } from "../../core/seed.js";
import { getLeaderboard, getReputation } from "../../reputation/reputation.js";
import { SkillSync } from "./index.js";

// Skill (enumeration row) -> SkillCard (what the UI renders). One place so search +
// detail map identically.
function toCard(s: Skill): SkillCard {
  return {
    id: s.id, type: s.type, name: s.name, description: s.description,
    category: s.category, hashtags: s.hashtags, supply: s.supply,
    price: s.price, creator: s.creator, requiredSkills: s.requiredSkills,
  };
}

// The marketplace half of a surface's ChatEnv. Spread it into the env object the
// surface passes to createChatSession. RPC comes from resolveRpcUrl() — a registered
// Helius key wins over the env override, which wins over the public-devnet default
// (issue #23), so the market always has a connection (reads need a DAS-capable RPC,
// i.e. a Helius key — the default returns empty results, which the UI can flag).
// The NFT indexer (agentnet-nft-indexer @ nft-index.iqlabs.dev) is the primary read
// path: it enumerates the Token-2022 collections (which DAS's getAssetsByGroup can't,
// since our TokenGroup isn't a Metaplex collection) and serves /items with supply +
// traits already filled. dasSource stays as a last-ditch fallback if the indexer is
// down. Override the URL with AGENTNET_INDEXER_URL.
const INDEXER_URL = getIndexerUrl();

function collectionIdFor(type?: "skill" | "workflow"): Promise<string | null> {
  const id = type === "workflow" ? getWorkflowsCollectionMint() : getSkillsCollectionMint();
  return Promise.resolve(id);
}

// Parse a human SOL string ("0.1", "2", "0") into integer lamports without float
// rounding: split on the decimal point and pad the fraction to 9 places. Returns
// null for anything not a non-negative decimal (so the caller can reject it).
// Exported so the publish_skill MCP tool reuses the exact same parse as the UI.
const LAMPORTS_PER_SOL = 1_000_000_000n;
export function solToLamports(sol: string): bigint | null {
  const s = sol.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  if (frac.length > 9) return null; // more precision than a lamport can hold
  return BigInt(whole) * LAMPORTS_PER_SOL + BigInt(frac.padEnd(9, "0") || "0");
}

export async function marketplaceEnv(wallet: Wallet) {
  const conn = new Connection(await resolveRpcUrl(), "confirmed");
  // Wire the chain layer's module-level connection. Writes (publishSkill -> codeIn,
  // ensureDbRoot, writeRow) go through core/chain.ts's singleton, which throws
  // "chain layer not initialized" until init() runs. Reads take conn directly, so
  // the market lists fine but a publish failed without this. Idempotent.
  initChain(conn);
  const skills = new SkillSync(conn);

  // Run a search via the indexer (fast, has supply+traits); fall back to a direct DAS
  // scan only if it errors (server down). `kind` = the active Skills/Workflows tab.
  async function runSearch(query: string, kind?: "skill" | "workflow"): Promise<Skill[]> {
    const filters = { keyword: query, ...(kind ? { type: kind } : {}) };
    try {
      return await searchSkills(conn, { source: indexerSource(INDEXER_URL), filters });
    } catch {
      return await searchSkills(conn, { source: dasSource, filters });
    }
  }

  return {
    async searchSkills(query: string, kind?: "skill" | "workflow"): Promise<SkillCard[]> {
      return (await runSearch(query, kind)).map(toCard);
    },

    // Full detail for one item: its card + the on-chain body (readSkillText) + — for a
    // workflow — the cards of its required skills + comments (issue #34).
    async getSkillDetail(mint: string): Promise<SkillDetail> {
      // find the card among all items (indexer has no single-item-with-traits route we
      // map; one search covers both kinds since they share the catalog).
      const all = await runSearch("");
      const card = all.find((s) => s.id === mint);
      const [skillText, notes, meta] = await Promise.all([
        readSkillText(conn, mint).catch(() => null),
        collectionIdFor(card?.type).then((cid) => cid ? readNotes(cid, mint).catch(() => []) : Promise.resolve([])),
        // A held skill can be ABSENT from the indexer catalog (DAS under-reports our
        // Token-2022 group), so `card` is undefined here. Read the mint's own metadata
        // so the detail shows a real name/description — not the bare mint — and treats
        // it as a skill (its comments live in the skills collection).
        card ? Promise.resolve(null) : readSkillMintMetadata(conn, mint).catch(() => null),
      ]);
      const reqIds = card?.requiredSkills ?? [];
      const requiredCards = reqIds
        .map((id) => all.find((s) => s.id === id))
        .filter((s): s is Skill => !!s)
        .map(toCard);
      return {
        card: card
          ? toCard(card)
          : { id: mint, type: "skill", name: meta?.name || mint, description: meta?.description },
        skillText,
        requiredCards,
        notes,
      };
    },

    // Post a comment on a skill (issue #34). collectionId resolved from skillType.
    async postNote(skillId: string, skillType: "skill" | "workflow" | undefined, text: string, gitLink?: string) {
      const collectionId = await collectionIdFor(skillType);
      if (!collectionId) return { ok: false, error: "Skills collection not configured" };
      try {
        await corePostNote(conn, wallet, { collectionId, skillId, text, gitLink });
        const notes = await readNotes(collectionId, skillId).catch(() => []);
        return { ok: true, notes };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    // creatorWallet comes from the search result (a Skill carries .creator); the
    // program pays the creator on a priced buy. Falls back to the buyer if absent.
    async buySkill(skillId: string, creatorWallet?: string) {
      try {
        await buySkill(conn, wallet, {
          skillId, buyerWallet: wallet.address, creatorWallet: creatorWallet || wallet.address,
        });
        const slug = await skills.installBoughtAll(skillId); // equip: drop SKILL.md into skills dirs
        return { ok: true, slug: slug ?? undefined };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    // make-skill: publish a new skill the user authored in the UI. priceSol is the
    // human SOL string from the form (default "0.1"); convert to lamports here so the
    // contract layer only ever sees lamports. image is passed through as-is (its shape
    // tells the viewer where it lives — skill-nft-json §3).
    async publishSkill(input: {
      name: string; description: string; text: string;
      category?: string; hashtags?: string[]; priceSol: string; image?: string;
    }): Promise<{ ok: boolean; mint?: string; error?: string }> {
      try {
        const lamports = solToLamports(input.priceSol);
        if (lamports === null) return { ok: false, error: "Enter a valid price in SOL (e.g. 0.1)" };
        const mint = await corePublishSkill(conn, wallet, {
          name: input.name,
          description: input.description,
          text: input.text,
          category: input.category,
          hashtags: input.hashtags,
          price: lamports,
          image: input.image,
        });
        return { ok: true, mint };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    // Load EVERY skill the wallet owns into both runtimes' skills dirs (issue #17).
    // Called at session start and again after a buy, so an agent always has its owned
    // skills present and discoverable — mirrors how last30days is installed before use.
    // Returns the installed slugs (best-effort; a bad mint is skipped).
    async loadOwnedSkills() {
      const [c] = await Promise.all([
        skills.injectOwned("claude", wallet.address),
        skills.injectOwned("codex", wallet.address),
      ]);
      return c;
    },

    // Native SOL balance (lamports) of the connected wallet — surfaced in the wallet
    // dropdown + market header so a buyer always sees their funds before/after a buy.
    // null on a read failure (bad RPC) so the UI can show "—" instead of hanging.
    async solBalance(): Promise<number | null> {
      try {
        return await getSolBalance(conn, wallet.address);
      } catch {
        return null;
      }
    },

    // Read one installed skill's local SKILL.md by slug name (for the equipped-skill doc
    // popup). The name is one we listed from claudeSkillsDir(), not free input, so there is
    // no path-traversal surface. Returns null if the file is missing/unreadable.
    async getSkillDoc(name: string): Promise<string | null> {
      try {
        return await readFile(join(claudeSkillsDir(), name, "SKILL.md"), "utf8");
      } catch {
        return null;
      }
    },

    // installed skill names = the dir names under the Claude skills dir (each is a slug).
    async ownedSkills() {
      try {
        const entries = await readdir(claudeSkillsDir(), { withFileTypes: true });
        return entries.filter((e) => e.isDirectory()).map((e) => e.name);
      } catch {
        return [];
      }
    },

    // The skills shown in the "Equipped skills" grid = the wallet's installed skills that
    // are real items (bought NFTs or hand-added local skills), NOT the app's bundled tools
    // (skill-shopping / make-skill — those live in the small built-in list, not the grid).
    //
    // Source = the local skills dir, classified by the origin manifest (skills.json). We do
    // NOT intersect the indexer catalog: a bought skill's per-buyer mint isn't a catalog
    // member, so that intersection is always empty (and it cost a DAS+indexer round-trip).
    // Installed = equipped here, which is exactly what the panel means. Network-free, no 429.
    async ownedNftSkills() {
      try {
        const entries = await readdir(claudeSkillsDir(), { withFileTypes: true });
        const slugs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
        const classified = await classifySkills(slugs);
        return classified.filter((c) => c.origin !== "bundled").map((c) => c.slug);
      } catch {
        return [];
      }
    },

    // slug -> mint for the wallet's installed NFT skills (from the origin manifest).
    // Lets the panel reuse the market's on-chain getSkillDetail(mint) path to show a
    // bought skill's body, instead of reading the local SKILL.md by (mismatched) name.
    async ownedSkillMints() {
      try {
        const entries = await readdir(claudeSkillsDir(), { withFileTypes: true });
        const slugs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
        const classified = await classifySkills(slugs);
        const out: Record<string, string> = {};
        for (const c of classified) if (c.mint) out[c.slug] = c.mint;
        return out;
      } catch {
        return {};
      }
    },

    // issue #35: agent directory ranked by totalSupply (indexer source; das fallback).
    async listAgents() {
      try {
        return await getLeaderboard(conn, 20, indexerSource(INDEXER_URL));
      } catch {
        return await getLeaderboard(conn, 20, dasSource);
      }
    },

    // issue #35: full agent profile — reputation + created/owned skills + notes.
    async getAgentProfile(agentWallet: string): Promise<AgentProfile> {
      let source;
      try { source = indexerSource(INDEXER_URL); } catch { source = dasSource; }

      // Fetch the agent's holdings (one cheap DAS owner query) IN PARALLEL with the
      // catalog, then decide owned-skills by intersecting in memory — no per-asset
      // on-chain group read. The owned list was already filtered against `all` before,
      // so this is the same result minus the getParsedAccountInfo fan-out that 429'd.
      const [reputation, all, ownedIds, notes] = await Promise.all([
        getReputation(conn, agentWallet, source).catch(() => ({
          wallet: agentWallet, skillsPublished: 0, totalSupply: 0, notesReceived: 0, updatedAt: Date.now(),
        })),
        // catch here too: a catalog fetch failure must NOT reject the whole profile
        // (otherwise the UI hangs on "Loading…"); degrade to empty created/owned lists.
        runSearch("").catch(() => [] as Skill[]),
        ownedAssetIds(agentWallet).catch(() => new Set<string>()),
        readAgentNotes(agentWallet).catch(() => []),
      ]);

      const createdSkills = all.filter((s) => s.creator === agentWallet).map(toCard);
      const ownedSkillCards = all.filter((s) => ownedIds.has(s.id)).map(toCard);

      return {
        wallet: agentWallet,
        self: agentWallet === wallet.address,
        reputation,
        createdSkills,
        ownedSkills: ownedSkillCards,
        notes,
      };
    },

    // issue #35: buy every skill a given agent created that the current wallet doesn't own.
    // Cap at 25 to avoid runaway; returns tallies so the UI can show a summary.
    async buyAllSkills(agentWallet: string) {
      const all = await runSearch("");
      const agentSkills = all.filter((s) => s.creator === agentWallet);
      // Reuse the catalog we just fetched (no second indexer round-trip, no per-asset reads).
      const alreadyOwned = new Set(await ownedSkillMints(wallet.address, all).catch(() => []));
      const toBuy = agentSkills.filter((s) => !alreadyOwned.has(s.id)).slice(0, 25);

      let bought = 0;
      let failed = 0;
      for (const s of toBuy) {
        try {
          await buySkill(conn, wallet, { skillId: s.id, buyerWallet: wallet.address, creatorWallet: s.creator || wallet.address });
          bought++;
        } catch {
          failed++;
        }
      }
      if (bought > 0) {
        await Promise.all([
          skills.injectOwned("claude", wallet.address),
          skills.injectOwned("codex", wallet.address),
        ]).catch(() => {});
      }
      return { ok: bought > 0 || toBuy.length === 0, bought, failed };
    },

    // issue #35: post a self-note (blog) or comment on an agent's profile.
    async postAgentNote(agentWallet: string, text: string, gitLink?: string) {
      try {
        let source;
        try { source = indexerSource(INDEXER_URL); } catch { source = dasSource; }
        await corePostAgentNote(conn, wallet, { agentWallet, text, gitLink, source });
        const notes = await readAgentNotes(agentWallet).catch(() => []);
        return { ok: true as const, notes };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
