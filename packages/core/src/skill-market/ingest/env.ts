// Marketplace env helper (issue #17) — bundles the three host-delegated chat callbacks
// (searchSkills / buySkill / ownedSkills) so a surface wires the market with one call
// instead of re-deriving a connection + signer itself. The chain connection comes from
// the same RPC env dasSource already uses, keeping one source of truth for the RPC.
//
// buySkill is the whole "user buys in the marketplace" flow for this PR: purchase the
// soulbound token, then install the bought skill's SKILL.md into BOTH runtimes' skills
// dirs (SkillSync) so it's discovered next session — search/buy were built yesterday,
// this is the wiring that makes a purchase actually equip the skill.

import { Connection, PublicKey } from "@solana/web3.js";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Wallet } from "../../runtime/contract.js";
import { searchSkills } from "../../search/index.js";
import { dasSource, indexerSource, ownedSkillMints } from "../../core/skillSource.js";
import { buySkill, publishSkill as corePublishSkill, type PublishProgress } from "../../nft/skill.js";
import { publishWorkflow as corePublishWorkflow } from "../../nft/workflow.js";
import { getSolBalance } from "../../notes/index.js";
import { readSkillText, readSkillMintMetadata } from "../../nft/token2022.js";
import { heldSkillCreators } from "../../notes/holdings.js";
import { claudeSkillsDir } from "../../core/paths.js";
import { classifySkills, readSkillManifest } from "../registry.js";
import { resolveRpcUrl } from "../../core/rpc.js";
import { init as initChain } from "../../core/chain.js";
import type { AgentProfile, Reputation, SkillCard, SkillDetail, VerifiedRepo } from "../../chat/marketMessages.js";
import type { Skill } from "../../core/types.js";
import { readNotes, postNote as corePostNote, readAgentNotes, postAgentNote as corePostAgentNote } from "../../notes/notes.js";
import { getSkillsCollectionMint, getWorkflowsCollectionMint, getIndexerUrl, getNetwork, type Network } from "../../core/seed.js";
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

// Verified work for a wallet. The indexer serves one row per (repo, skill) link, so a repo
// backing N skills comes back N times; group by repo id, collect the skill mints, keep the
// cached stars/forks. Best-effort: any failure yields [] so the profile still loads.
async function fetchVerifiedRepos(wallet: string): Promise<VerifiedRepo[]> {
  const res = await fetch(`${INDEXER_URL}/work-links?wallet=${encodeURIComponent(wallet)}`);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    links?: Array<{ github_repo_id: string; repo_owner: string; repo_name: string; repo_url: string; stars: number; forks: number; skill_mint: string }>;
  };
  const byRepo = new Map<string, VerifiedRepo>();
  for (const l of data.links ?? []) {
    const found = byRepo.get(l.github_repo_id);
    if (found) {
      if (l.skill_mint && !found.skillMints.includes(l.skill_mint)) found.skillMints.push(l.skill_mint);
    } else {
      byRepo.set(l.github_repo_id, {
        owner: l.repo_owner,
        name: l.repo_name,
        url: l.repo_url,
        stars: l.stars ?? 0,
        forks: l.forks ?? 0,
        skillMints: l.skill_mint ? [l.skill_mint] : [],
      });
    }
  }
  return [...byRepo.values()];
}

// Summed verified-work stars for many wallets in ONE indexer call (the directory's reputation
// axis). Throws on a non-OK response so the caller can fall back to per-wallet lookups against
// an older indexer that lacks this aggregated route.
async function fetchStarsByWallet(wallets: string[]): Promise<Record<string, number>> {
  const qs = wallets.length ? `?wallets=${encodeURIComponent(wallets.join(","))}` : "";
  const res = await fetch(`${INDEXER_URL}/work-links/stars${qs}`);
  if (!res.ok) throw new Error(`stars-by-wallet ${res.status}`);
  const data = (await res.json()) as { stars?: Record<string, number> };
  return data.stars ?? {};
}

function collectionIdFor(type?: "skill" | "workflow"): Promise<string | null> {
  const id = type === "workflow" ? getWorkflowsCollectionMint() : getSkillsCollectionMint();
  return Promise.resolve(id);
}

// An owned skill's body is also on disk — its SKILL.md is what the agent actually loads —
// so when the on-chain read comes back empty (RPC throttled, gateway/network mismatch, a
// revoked Helius key) we fall back to the local file instead of showing a bodyless detail.
// This is the pre-on-chain behavior the equipped popup used to have, kept as a safety net.
// mint -> slug via the origin manifest; strip frontmatter to match the body-only on-chain
// shape. Returns null when the mint isn't an installed skill or the file is unreadable.
async function localSkillBody(mint: string): Promise<string | null> {
  try {
    const manifest = await readSkillManifest();
    const slug = Object.keys(manifest.nft).find((s) => manifest.nft[s].mint === mint);
    if (!slug) return null;
    const raw = await readFile(join(claudeSkillsDir(), slug, "SKILL.md"), "utf8");
    return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim() || null;
  } catch {
    return null;
  }
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

// A wallet with no SOL on the active cluster fails fee payment before any program runs,
// surfacing as "Attempt to debit an account but found no record of a prior credit. Logs: []"
// (or a bare "insufficient lamports"). To a person these all mean one thing: not enough SOL.
const INSUFFICIENT_FUNDS_RE = /no record of a prior credit|attempt to debit|insufficient lamports|insufficient funds/i;

/** True when a buy error is really "the wallet is out of SOL" (so the UI can offer to fund). */
export function isInsufficientFundsError(err: unknown): boolean {
  return INSUFFICIENT_FUNDS_RE.test(err instanceof Error ? err.message : String(err));
}

// Turn an opaque buy/simulation error into one line a buyer can act on. Anything we don't
// recognise is passed through verbatim so real errors stay debuggable. Shared by the UI buy
// (env.buySkill) and the agent buy (buy_skill tool) so both explain a broke wallet the same
// way. No emoji / em-dash (UI copy rules).
export function friendlyBuyError(err: unknown, network: Network = getNetwork()): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (INSUFFICIENT_FUNDS_RE.test(raw)) {
    return network === "devnet"
      ? "Not enough SOL on devnet to cover this purchase and the network fee. Fund this wallet with devnet SOL, then try again."
      : "Not enough SOL to cover this purchase and the network fee. Add funds to this wallet, then try again.";
  }
  return raw;
}

// One devnet faucet grant. 1 SOL is comfortably above any skill price + fees and within the
// per-request devnet cap; the public faucet is rate-limited, so a request can still fail.
const AIRDROP_LAMPORTS = 1_000_000_000;

function publishFrontmatter(text: string): { type?: string; requiredSkills?: string[] } {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return {};
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") { closeIdx = i; break; }
  }
  if (closeIdx === -1) return {};

  const out: { type?: string; requiredSkills?: string[] } = {};
  for (const line of lines.slice(1, closeIdx)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const raw = line.slice(colon + 1).trim();
    if (key === "type") out.type = raw.replace(/^['"]|['"]$/g, "");
    if (key === "requiredSkills" && raw.startsWith("[") && raw.endsWith("]")) {
      out.requiredSkills = raw
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    }
  }
  return out;
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
      const [onChainText, notes, meta] = await Promise.all([
        readSkillText(conn, mint).catch(() => null),
        collectionIdFor(card?.type).then((cid) => cid ? readNotes(cid, mint).catch(() => []) : Promise.resolve([])),
        // A held skill can be ABSENT from the indexer catalog (DAS under-reports our
        // Token-2022 group), so `card` is undefined here. Read the mint's own metadata
        // so the detail shows a real name/description — not the bare mint — and treats
        // it as a skill (its comments live in the skills collection).
        card ? Promise.resolve(null) : readSkillMintMetadata(conn, mint).catch(() => null),
      ]);
      // On-chain body is the source of truth; if it's empty (RPC/gateway hiccup) but we
      // own this skill, show the local SKILL.md so the detail never renders bodyless.
      const skillText = onChainText ?? (await localSkillBody(mint));
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
        // buy on-chain + equip (install SKILL.md) in one shared call — the SAME path the
        // agent's buy_skill MCP tool uses, so a UI buy and an agent buy equip identically.
        const { slug } = await skills.buyAndEquip(wallet, skillId, creatorWallet || wallet.address);
        return { ok: true as const, slug: slug ?? undefined };
      } catch (e) {
        return {
          ok: false as const,
          error: friendlyBuyError(e),
          code: isInsufficientFundsError(e) ? ("insufficient_funds" as const) : undefined,
        };
      }
    },

    // Un-equip an owned skill — the inverse of buySkill, shared with the
    // unequip_skill MCP tool. Local + sticky (soulbound: the NFT stays owned, no refund).
    async disposeSkill(skillId: string) {
      try {
        const slug = await skills.dispose(skillId);
        return { ok: true, slug: slug ?? undefined };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    // Re-equip a previously-disposed skill the wallet still owns (undo a dispose without
    // re-buying). Clears the disposed mark and re-installs the SKILL.md.
    async reEquipSkill(skillId: string) {
      try {
        const slug = await skills.reEquip(skillId);
        return { ok: true, slug: slug ?? undefined };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    // slug -> mint for the wallet's DISPOSED (un-pinned) skills, from the manifest. The UI
    // shows these greyed in the equipped panel and offers a free Re-equip (not a paid re-Buy
    // that would mint another copy). Parallel to ownedSkillMints, but for the disposed set.
    async disposedSkillMints(): Promise<Record<string, string>> {
      try {
        const m = await readSkillManifest();
        const disposed = new Set(m.disposed);
        const out: Record<string, string> = {};
        for (const slug of Object.keys(m.nft)) {
          if (disposed.has(m.nft[slug].mint)) out[slug] = m.nft[slug].mint;
        }
        return out;
      } catch {
        return {};
      }
    },

    // make-skill: publish a new skill the user authored in the UI. priceSol is the
    // human SOL string from the form (default "0.1"); convert to lamports here so the
    // contract layer only ever sees lamports. image is passed through as-is (its shape
    // tells the viewer where it lives — skill-nft-json §3).
    async publishSkill(input: {
      name: string; description: string; text: string;
      category?: string; hashtags?: string[]; priceSol: string; image?: string;
    }, onProgress?: (p: PublishProgress) => void): Promise<{ ok: boolean; mint?: string; error?: string }> {
      try {
        const lamports = solToLamports(input.priceSol);
        if (lamports === null) return { ok: false, error: "Enter a valid price in SOL (e.g. 0.1)" };
        const frontmatter = publishFrontmatter(input.text);
        if (frontmatter.type === "workflow") {
          const mint = await corePublishWorkflow(conn, wallet, {
            name: input.name,
            description: input.description,
            text: input.text,
            requiredSkills: frontmatter.requiredSkills ?? [],
            category: input.category,
            hashtags: input.hashtags,
            price: lamports,
          }, onProgress);
          return { ok: true, mint };
        }
        const mint = await corePublishSkill(conn, wallet, {
          name: input.name,
          description: input.description,
          text: input.text,
          category: input.category,
          hashtags: input.hashtags,
          price: lamports,
          image: input.image,
        }, onProgress);
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

    // Manual "Get devnet SOL": request one faucet grant to the connected wallet, wait for
    // it, and report the new balance so the UI can refresh and let the buyer retry. Devnet
    // only, since mainnet has no faucet. The public devnet faucet is rate-limited, so a
    // failure here is expected sometimes; we surface the reason rather than swallowing it.
    async airdrop(): Promise<{ ok: boolean; lamports?: number; error?: string }> {
      if (getNetwork() !== "devnet") {
        return { ok: false, error: "Airdrop is available on devnet only. Add SOL to this wallet to continue." };
      }
      try {
        const sig = await conn.requestAirdrop(new PublicKey(wallet.address), AIRDROP_LAMPORTS);
        await conn.confirmTransaction(sig, "confirmed");
        const lamports = await getSolBalance(conn, wallet.address).catch(() => undefined);
        return { ok: true, lamports };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
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

    // The wallet's owned NFT skills read straight from CHAIN (its Token-2022 holdings),
    // hydrated to cards — the same source the agent profile's `ownedSkills` uses, NOT the
    // local skills dir. ownedNftSkills() above is "what's installed here"; this is "what the
    // wallet actually holds on-chain", so My Skills shows bought NFTs even before they've
    // been installed locally. DAS-free + indexer-independent (getTokenAccountsByOwner + one
    // batched getMultipleAccounts via heldSkillCreators); the catalog hydrates names, and a
    // mint the indexer never cataloged falls back to its own on-chain metadata.
    async ownedSkillCards(): Promise<SkillCard[]> {
      const [all, holdings] = await Promise.all([
        runSearch("").catch(() => [] as Skill[]),
        heldSkillCreators(wallet.address).catch(() => new Map<string, string>()),
      ]);
      const byId = new Map(all.map((s) => [s.id, s]));
      return Promise.all([...holdings.keys()].map(async (mint) => {
        const inCatalog = byId.get(mint);
        if (inCatalog) return toCard(inCatalog);
        const md = await readSkillMintMetadata(conn, mint).catch(() => null);
        return { id: mint, type: "skill", name: md?.name || mint, description: md?.description } as SkillCard;
      }));
    },

    // issue #35: agent directory ranked by totalSupply. The indexer now enumerates
    // items via the gate program (authority-independent), so its creator ranking is
    // complete — no client-side augmentation needed. das is the fallback when the
    // indexer is down.
    async listAgents() {
      let board: Reputation[];
      try {
        board = await getLeaderboard(conn, 20, indexerSource(INDEXER_URL));
      } catch {
        board = await getLeaderboard(conn, 20, dasSource);
      }
      // Attach a reputation axis (summed verified-work stars) alongside totalSupply (popularity)
      // so the directory can show both. ONE aggregated indexer call for the whole board; if that
      // route is missing (older indexer deploy) fall back to per-wallet /work-links lookups.
      // Display-only: any failure yields 0 stars and never blocks the list.
      const wallets = board.map((a) => a.wallet);
      let starsMap: Record<string, number>;
      try {
        starsMap = await fetchStarsByWallet(wallets);
      } catch {
        const pairs = await Promise.all(
          wallets.map(async (w) => {
            const repos = await fetchVerifiedRepos(w).catch(() => [] as VerifiedRepo[]);
            return [w, repos.reduce((sum, r) => sum + (r.stars ?? 0), 0)] as const;
          }),
        );
        starsMap = Object.fromEntries(pairs);
      }
      return board.map((a) => ({ ...a, stars: starsMap[a.wallet] ?? 0 }));
    },

    // issue #35: full agent profile — reputation + created/owned skills + notes.
    async getAgentProfile(agentWallet: string): Promise<AgentProfile> {
      let source;
      try { source = indexerSource(INDEXER_URL); } catch { source = dasSource; }

      // Fetch the catalog ONCE, then derive reputation, owned mints, and notes from it
      // concurrently. The old shape refetched the catalog inside getReputation (a second
      // indexer round-trip) and then serialized ownedSkillMints (+ its on-chain gap
      // rescue) AND the per-mint card hydration AFTER the parallel block — so a whale
      // wallet's profile ran catalog → rescue → hydrate back to back. Now the rescue
      // overlaps reputation/notes, and reputation reuses `all` instead of refetching.
      // catch on the catalog: a fetch failure must NOT reject the whole profile
      // (otherwise the UI hangs on "Loading…"); degrade to empty created/owned lists.
      const all = await runSearch("").catch(() => [] as Skill[]);
      const [reputation, notes, holdings, verifiedRepos] = await Promise.all([
        getReputation(conn, agentWallet, source, all).catch(() => ({
          wallet: agentWallet, skillsPublished: 0, totalSupply: 0, notesReceived: 0, updatedAt: Date.now(),
        })),
        readAgentNotes(agentWallet).catch(() => []),
        // The agent's held skills mapped to their on-chain creator — DAS-FREE and
        // INDEXER-INDEPENDENT (getTokenAccountsByOwner + one batched getMultipleAccounts).
        // Gives both the owned-mints (keys) and, for created-skills, the on-chain creator
        // that the catalog under-reports (see below).
        heldSkillCreators(agentWallet).catch(() => new Map<string, string>()),
        // Verified GitHub work + cached stars from the indexer (Phase 1.5). Best-effort:
        // a failure yields [] so the profile still renders without the section.
        fetchVerifiedRepos(agentWallet).catch(() => [] as VerifiedRepo[]),
      ]);

      const byId = new Map(all.map((s) => [s.id, s]));
      // Hydrate a mint to a card from the catalog, else from its own on-chain metadata
      // (gateway code-in) — so a skill the indexer never cataloged still shows a name.
      const cardFor = async (mint: string): Promise<SkillCard> => {
        const inCatalog = byId.get(mint);
        if (inCatalog) return toCard(inCatalog);
        const md = await readSkillMintMetadata(conn, mint).catch(() => null);
        return { id: mint, type: "skill", name: md?.name || mint, description: md?.description };
      };

      // Created skills = catalog skills by this agent ∪ skills the agent HOLDS that they
      // themselves minted. A publisher self-mints the first copy on publish, so their own
      // creations sit in their holdings with creator == agentWallet — and the indexer
      // catalog under-reports our Token-2022 members, so a freshly-published skill (e.g.
      // one minted yesterday) is often absent from the catalog and would otherwise never
      // appear on its creator's own profile. The on-chain creator rescues it.
      const createdIds = new Set(all.filter((s) => s.creator === agentWallet).map((s) => s.id));
      for (const [mint, creator] of holdings) if (creator === agentWallet) createdIds.add(mint);
      const createdSkills = await Promise.all([...createdIds].map(cardFor));

      // Owned skills = everything the agent holds in our collections (the holdings keys).
      const ownedSkillCards = await Promise.all([...holdings.keys()].map(cardFor));

      // May the connected wallet comment here? Same on-chain gate as postAgentNote:
      // it holds ≥1 skill THIS agent created. For self, `holdings` already is the
      // connected wallet's; otherwise read the viewer's holdings (cached).
      const self = agentWallet === wallet.address;
      let canComment = false;
      const viewerHoldings = self ? holdings : await heldSkillCreators(wallet.address).catch(() => new Map<string, string>());
      for (const creator of viewerHoldings.values()) if (creator === agentWallet) { canComment = true; break; }

      return {
        wallet: agentWallet,
        self,
        reputation,
        createdSkills,
        ownedSkills: ownedSkillCards,
        notes,
        canComment,
        verifiedRepos,
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
    async postAgentNote(agentWallet: string, text: string, gitLink?: string, title?: string, image?: string, parentId?: string) {
      try {
        let source;
        try { source = indexerSource(INDEXER_URL); } catch { source = dasSource; }
        await corePostAgentNote(conn, wallet, { agentWallet, text, gitLink, title, image, parentId, source });
        const notes = await readAgentNotes(agentWallet).catch(() => []);
        return { ok: true as const, notes };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
