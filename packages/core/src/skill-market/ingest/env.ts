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
import { readdir } from "node:fs/promises";
import type { Wallet } from "../../runtime/contract.js";
import { searchSkills } from "../../search/index.js";
import { dasSource, indexerSource } from "../../core/skillSource.js";
import { buySkill } from "../../nft/skill.js";
import { readSkillText } from "../../nft/token2022.js";
import { claudeSkillsDir } from "../../core/paths.js";
import { resolveRpcUrl } from "../../core/rpc.js";
import type { SkillCard, SkillDetail } from "../../chat/marketMessages.js";
import type { Skill } from "../../core/types.js";
import { SkillSync } from "./index.js";

// Skill (enumeration row) -> SkillCard (what the UI renders). One place so search +
// detail map identically.
function toCard(s: Skill): SkillCard {
  return {
    id: s.id, type: s.type, name: s.name, description: s.description,
    category: s.category, hashtags: s.hashtags, supply: s.supply,
    creator: s.creator, requiredSkills: s.requiredSkills,
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
const INDEXER_URL = process.env.AGENTNET_INDEXER_URL || "https://nft-index.iqlabs.dev";

export async function marketplaceEnv(wallet: Wallet) {
  const conn = new Connection(await resolveRpcUrl(), "confirmed");
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
    // workflow — the cards of its required skills, so the UI can render them clickable.
    async getSkillDetail(mint: string): Promise<SkillDetail> {
      // find the card among all items (indexer has no single-item-with-traits route we
      // map; one search covers both kinds since they share the catalog).
      const all = await runSearch("");
      const card = all.find((s) => s.id === mint);
      const skillText = await readSkillText(conn, mint).catch(() => null);
      const reqIds = card?.requiredSkills ?? [];
      const requiredCards = reqIds
        .map((id) => all.find((s) => s.id === id))
        .filter((s): s is Skill => !!s)
        .map(toCard);
      return {
        card: card ? toCard(card) : { id: mint, name: mint },
        skillText,
        requiredCards,
      };
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

    // installed skill names = the dir names under the Claude skills dir (each is a slug).
    async ownedSkills() {
      try {
        const entries = await readdir(claudeSkillsDir(), { withFileTypes: true });
        return entries.filter((e) => e.isDirectory()).map((e) => e.name);
      } catch {
        return [];
      }
    },
  };
}
