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

export interface SkillSource {
  /** Enumerate all known skills/workflows (id set + cached metadata snapshot). */
  listSkills(limit?: number): Promise<Skill[]>;
}

/** Pull category (single) + hashtags (repeated "skill" traits) out of a code-in
 *  JSON's standard `attributes` array (skill-nft-json.md §4). DAS surfaces these
 *  under content.metadata.attributes after resolving the mint's uri. */
function traitsFromAttributes(
  attributes: unknown,
): { category: string; hashtags: string[] } {
  if (!Array.isArray(attributes)) return { category: "", hashtags: [] };
  let category = "";
  const hashtags: string[] = [];
  for (const a of attributes) {
    if (!a || typeof a.value !== "string") continue;
    if (a.trait_type === "category") category = a.value;
    else if (a.trait_type === "skill") hashtags.push(a.value);
  }
  return { category, hashtags };
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
    const rpcUrl = process.env.DAS_RPC_URL || process.env.SOLANA_RPC_URL;
    const { getSkillsCollectionMint, getWorkflowsCollectionMint } = await import("./seed.js");
    const skillsCollection = getSkillsCollectionMint();
    const workflowsCollection = getWorkflowsCollectionMint();

    if (!rpcUrl) {
      throw new Error("dasSource: no DAS_RPC_URL / SOLANA_RPC_URL configured");
    }
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
        const { category, hashtags } = traitsFromAttributes(item.content?.metadata?.attributes);
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
