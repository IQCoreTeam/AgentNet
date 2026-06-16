// SkillSource — the enumeration seam for "which skills/workflows exist".
//
// skill-nft-structure.md §2 is emphatic: "No skills registry table. The NFT
// collection IS the skill list." The canonical truth is each mint's `uri`
// (a code-in JSON holding name/description/attributes/skillText, §4) + its
// live `supply`, enumerated by scanning the TokenGroup umbrella via DAS — which
// resolves that uri into content.metadata, so traits arrive in the scan.
//
// There is no `skills:index` cache table anymore — the collection scan is the
// only source. Until a DAS provider proves it indexes the Token-2022 group
// extension under `getAssetsByGroup` (see the probe + the warning on dasSource),
// this returns whatever DAS gives (an empty list when collections are unminted
// is a real, visible answer — not a hidden failure). The seam stays so a
// gateway enumerator can replace it later without changing search/reviews.

import type { Skill } from "./types.js";
import { resolveRpcUrl } from "./rpc.js";

export interface SkillSource {
  /** Enumerate all known skills/workflows (id set + cached metadata snapshot). */
  listSkills(limit?: number): Promise<Skill[]>;
  /**
   * True when listSkills() returns live `supply` already filled (e.g. an indexer
   * that stored it). Callers then SKIP the per-mint getMintSupply hydration loop.
   * dasSource leaves it undefined/false — its `supply` is 0 and must be hydrated.
   */
  hydrated?: boolean;
}

/** Pull the standard traits out of a code-in JSON's `attributes` array
 *  (skill-nft-json.md §4/§4b): `category` (single), `skill` (repeated hashtags),
 *  and `requiredSkill` (repeated prerequisite mint ids, workflows only). DAS
 *  surfaces these under content.metadata.attributes after resolving the uri. */
function traitsFromAttributes(
  attributes: unknown,
): { category: string; hashtags: string[]; requiredSkills: string[] } {
  if (!Array.isArray(attributes)) return { category: "", hashtags: [], requiredSkills: [] };
  let category = "";
  const hashtags: string[] = [];
  const requiredSkills: string[] = [];
  for (const a of attributes) {
    if (!a || typeof a.value !== "string") continue;
    if (a.trait_type === "category") category = a.value;
    else if (a.trait_type === "skill") hashtags.push(a.value);
    else if (a.trait_type === "requiredSkill") requiredSkills.push(a.value);
  }
  return { category, hashtags, requiredSkills };
}

/**
 * DAS (Digital Asset Standard) source — enumerates the TokenGroup umbrella
 * collections via a DAS RPC's `getAssetsByGroup`. This is the §2 "collection IS
 * the skill list" reader — the single source of truth for enumeration.
 *
 * ⚠️ UNVERIFIED ASSUMPTION: DAS `groupKey:"collection"` is sourced from a
 * Metaplex Token-Metadata `collection`, NOT the Token-2022 `TokenGroup`
 * extension our mints use. Whether a given DAS provider surfaces Token-2022
 * group membership under that key is unconfirmed — it may return nothing. It
 * does NOT hide that: it throws on misconfig, surfaces RPC errors, and returns
 * exactly what DAS gives. Settle the assumption with a devnet probe.
 */
export const dasSource: SkillSource = {
  async listSkills(limit = 1000): Promise<Skill[]> {
    // registered Helius key wins; else env; else public-devnet default (issue #23).
    // Note: the default lacks DAS, so reads come back empty there — a Helius key is
    // what actually surfaces skills (the UI flags this).
    const rpcUrl = await resolveRpcUrl();
    const { getSkillsCollectionMint, getWorkflowsCollectionMint } = await import("./seed.js");
    const skillsCollection = getSkillsCollectionMint();
    const workflowsCollection = getWorkflowsCollectionMint();

    if (!skillsCollection && !workflowsCollection) {
      throw new Error(
        "dasSource: no collection mints configured (AGENTNET_SKILLS_COLLECTION_PUBKEY / _WORKFLOWS_)",
      );
    }

    const skills: Skill[] = [];

    async function fetchGroup(group: string, type: "skill" | "workflow") {
      const response = await fetch(rpcUrl!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          method: "getAssetsByGroup",
          params: { groupKey: "collection", groupValue: group, page: 1, limit },
        }),
      });

      const json = await response.json();
      if (json.error) {
        throw new Error(`DAS getAssetsByGroup failed for ${group}: ${JSON.stringify(json.error)}`);
      }
      for (const item of json.result?.items ?? []) {
        // DAS resolves the mint's uri (our code-in JSON) into content.metadata,
        // so the standard `attributes` arrive here already merged — category +
        // hashtags come straight from the scan (skill-nft-json.md §4), no
        // per-mint re-read. supply is the one field DAS doesn't carry live, so
        // search.ts still hydrates that from the mint.
        const { category, hashtags, requiredSkills } = traitsFromAttributes(item.content?.metadata?.attributes);
        skills.push({
          id: item.id,
          type,
          name: item.content?.metadata?.name || "Unknown",
          description: item.content?.metadata?.description || "",
          // Token-2022 has no Metaplex `creators`; fall back to the asset
          // authority (= update authority). May be empty — caller tolerates.
          creator: item.authorities?.[0]?.address || "",
          category,
          hashtags,
          requiredSkills,
          price: "0",
          supply: 0, // hydrated by getMintSupply (live counter, not in the scan)
          uriTxid: item.content?.json_uri || "",
          createdAt: 0,
        });
      }
    }

    if (skillsCollection) await fetchGroup(skillsCollection, "skill");
    if (workflowsCollection) await fetchGroup(workflowsCollection, "workflow");

    return skills.slice(0, limit);
  },
};

/**
 * On-chain truth for collection membership: read a mint's Token-2022
 * TokenGroupMember extension and return its `group` (the collection mint the NFT
 * was actually enrolled in at mint time). This is the ground truth for "which
 * collection is this NFT in" — unlike DAS's `grouping.group_value`, which is an
 * *indexer* projection that, for our Token-2022 TokenGroup mints, surfaces a
 * synthetic group id instead of the real group mint and so never matches our seed.
 */
async function onChainGroup(
  conn: import("@solana/web3.js").Connection,
  PublicKey: typeof import("@solana/web3.js").PublicKey,
  mint: string,
): Promise<string | null> {
  const acct = await conn.getParsedAccountInfo(new PublicKey(mint));
  const data = acct.value?.data as { parsed?: { info?: { extensions?: unknown[] } } } | undefined;
  const exts = data?.parsed?.info?.extensions ?? [];
  for (const ext of exts as { extension?: string; state?: { group?: string } }[]) {
    if (ext.extension === "tokenGroupMember" && ext.state?.group) return ext.state.group;
  }
  return null;
}

/**
 * The skill/workflow NFT mints a wallet OWNS (issue #17 — auto-load owned skills at
 * session start). Owned membership is read from on-chain truth, not the indexer or
 * DAS's group projection: DAS getAssetsByOwner only tells us which assets the wallet
 * holds (an owner query, unaffected by group representation); each grouped candidate's
 * real collection is then read from its Token-2022 TokenGroupMember.group and matched
 * against our seed mints. We deliberately do NOT trust DAS `grouping.group_value` here
 * — for our TokenGroup mints it's a synthetic id that never equals the seed mint, so
 * the wallet's real skills would be dropped (verified on devnet). Returns [] if
 * RPC/collections aren't configured (best-effort caller).
 */
export async function ownedSkillMints(owner: string): Promise<string[]> {
  const rpcUrl = await resolveRpcUrl(); // Helius key > env > default (issue #23)
  const { getSkillsCollectionMint, getWorkflowsCollectionMint } = await import("./seed.js");
  const ours = new Set([getSkillsCollectionMint(), getWorkflowsCollectionMint()].filter(Boolean) as string[]);
  if (ours.size === 0) return [];

  // Owner query (cheap, paged): every asset the wallet holds that carries a "collection"
  // grouping is a candidate. We resolve its REAL collection on-chain below — the DAS
  // group_value itself is never compared to the seed (it's a synthetic id for our mints).
  const candidates: string[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: "1", method: "getAssetsByOwner",
        params: { ownerAddress: owner, page, limit: 1000 },
      }),
    });
    const json = await res.json();
    if (json.error) throw new Error(`DAS getAssetsByOwner failed: ${JSON.stringify(json.error)}`);
    const items = json.result?.items ?? [];
    for (const it of items) {
      const groups = (it.grouping ?? []) as { group_key?: string; group_value?: string }[];
      if (groups.some((g) => g.group_key === "collection" && g.group_value)) candidates.push(it.id);
    }
    if (items.length < 1000) break; // last page
  }
  if (candidates.length === 0) return [];

  // Keep the candidates whose on-chain TokenGroupMember.group is one of our collections.
  // One Connection, candidates read in parallel (typically a handful).
  const { Connection, PublicKey } = await import("@solana/web3.js");
  const conn = new Connection(rpcUrl, "confirmed");
  const groups = await Promise.all(
    candidates.map((id) => onChainGroup(conn, PublicKey, id).catch(() => null)),
  );
  return candidates.filter((_, i) => {
    const g = groups[i];
    return !!g && ours.has(g);
  });
}

/**
 * The skills a wallet OWNS, hydrated to {id, name, description} for display (e.g. the CLI
 * welcome panel's "my skills" column). ownedSkillMints gives the mint set; we read each
 * mint's Token-2022 metadata for its name/description. Best-effort: a mint whose metadata
 * can't be read is dropped, so the list never throws on a single bad entry.
 */
export async function ownedSkills(
  owner: string,
): Promise<{ id: string; name: string; description?: string }[]> {
  const mints = await ownedSkillMints(owner);
  if (mints.length === 0) return [];
  const rpcUrl = await resolveRpcUrl();
  const { Connection } = await import("@solana/web3.js");
  const { readSkillMintMetadata } = await import("../nft/token2022.js");
  const conn = new Connection(rpcUrl, "confirmed");
  const out: { id: string; name: string; description?: string }[] = [];
  for (const id of mints) {
    try {
      const md = await readSkillMintMetadata(conn, id);
      if (md) out.push({ id, name: md.name, description: md.description });
    } catch {
      // skip a mint we can't read rather than failing the whole list
    }
  }
  return out;
}

/** The indexer's item shape (agentnet-nft-indexer GET /items). Declared here so
 *  core stays independent of the indexer repo — we only depend on its wire JSON. */
interface IndexerItem {
  mint: string;
  type: "skill" | "workflow";
  name: string;
  description: string;
  creator: string | null;
  supply: number;
  attributes: { trait_type: string; value: string }[];
}

/**
 * Indexer source — enumerates via the NFT indexer's `/items` instead of a raw
 * DAS scan. The indexer already stored live `supply` + traits from its own scan,
 * so this is `hydrated: true`: searchSkills / reputation skip their per-mint
 * getMintSupply loops. It's the fast path; dasSource is the fallback when the
 * indexer is unreachable (the caller catches and swaps source).
 *
 * No dependency on the indexer repo — just its HTTP JSON. baseUrl e.g.
 * "https://nft-index.iqlabs.dev".
 */
export function indexerSource(baseUrl: string): SkillSource {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    hydrated: true,
    async listSkills(limit = 1000): Promise<Skill[]> {
      const res = await fetch(`${base}/items?limit=${limit}&sort=supply`, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`indexer /items → HTTP ${res.status}`);
      const { items } = (await res.json()) as { items: IndexerItem[] };
      return items.map((it) => {
        const { category, hashtags, requiredSkills } = traitsFromAttributes(it.attributes);
        return {
          id: it.mint,
          type: it.type,
          name: it.name,
          description: it.description,
          creator: it.creator ?? "",
          category,
          hashtags,
          requiredSkills,
          price: "0",
          supply: it.supply, // live — already hydrated by the indexer
          uriTxid: "",
          createdAt: 0,
        };
      });
    },
  };
}
