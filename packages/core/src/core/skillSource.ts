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

/** Token-2022 program id — our skill/workflow mints all live under it (NonTransferable +
 *  TokenGroup). Used to enumerate a wallet's skill holdings via the STANDARD RPC
 *  getTokenAccountsByOwner, which works on any node (no DAS tier needed). */
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** Minimal shape of a DAS JSON-RPC response. `fetch(...).json()` is `unknown`
 *  under @types/node's fetch typings (no DOM lib) — only `any` when a DOM lib is
 *  present. core's own tsconfig happens to pull in DOM (no explicit `lib`), but
 *  surfaces that compile core under a Node-only lib (e.g. surfaces/localhost)
 *  would otherwise see TS18046 on every `json.error`/`json.result` access. This
 *  narrows the result so skillSource stays type-safe regardless of surface lib. */
type DasRpcResponse = {
  error?: unknown;
  result?: { items?: any[] };
};

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

      const json = (await response.json()) as DasRpcResponse;
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
async function onChainGroup(rpcUrl: string, mint: string): Promise<string | null> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: "1", method: "getAccountInfo",
      params: [mint, { encoding: "jsonParsed" }],
    }),
  });
  const json = (await res.json()) as {
    result?: { value?: { data?: { parsed?: { info?: { extensions?: unknown[] } } } } };
  };
  const exts = json.result?.value?.data?.parsed?.info?.extensions ?? [];
  for (const ext of exts as { extension?: string; state?: { group?: string } }[]) {
    if (ext.extension === "tokenGroupMember" && ext.state?.group) return ext.state.group;
  }
  return null;
}

/**
 * Every Token-2022 NFT mint a wallet HOLDS — via the STANDARD RPC getTokenAccountsByOwner
 * over the Token-2022 program, NOT DAS getAssetsByOwner.
 *
 * Why not DAS: DAS (getAssetsByGroup/getAssetsByOwner) needs a DAS-tier provider. A
 * non-DAS Helius key answers standard RPC fine but returns "Unauthorized" on DAS, which
 * silently emptied the owned list (the agent-profile owned section, comment gate, and
 * session-start skill injection all went blank). getTokenAccountsByOwner is a plain RPC
 * call every node serves, so owned-skill resolution no longer depends on a DAS tier — it
 * only needs the gateway (code-in body) + optional indexer (catalog). It also sidesteps
 * the long-standing problem that DAS under-reports our Token-2022 TokenGroup membership.
 *
 * Returns the held mints; this is NOT "which are OUR skills" — that's decided downstream
 * (ownedSkillMints) by catalog intersection + the on-chain TokenGroupMember group. We keep
 * only NFT-like holdings (0 decimals, ≥1 unit) so fungible balances don't enlarge the
 * downstream gap-rescue. Throws on an RPC error so callers can fall back/catch.
 */
export async function ownedAssetIds(owner: string): Promise<Set<string>> {
  const rpcUrl = await resolveRpcUrl(); // Helius key > env > default (issue #23)
  const ids = new Set<string>();
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: "1", method: "getTokenAccountsByOwner",
      params: [owner, { programId: TOKEN_2022_PROGRAM_ID }, { encoding: "jsonParsed" }],
    }),
  });
  const json = (await res.json()) as {
    error?: unknown;
    result?: { value?: { account?: { data?: { parsed?: { info?: any } } } }[] };
  };
  if (json.error) throw new Error(`getTokenAccountsByOwner failed: ${JSON.stringify(json.error)}`);
  for (const acct of json.result?.value ?? []) {
    const info = acct.account?.data?.parsed?.info;
    const amt = info?.tokenAmount;
    // NFT-like: exactly 0 decimals and at least one unit held (our soulbound skills are 1).
    if (info?.mint && amt && amt.decimals === 0 && Number(amt.uiAmount ?? amt.uiAmountString ?? 0) >= 1) {
      ids.add(info.mint);
    }
  }
  return ids;
}

/**
 * The skill/workflow NFT mints a wallet OWNS (issue #17 — auto-load owned skills at
 * session start; agent-profile owned list).
 *
 * Fast path: a mint that is BOTH in the catalog (the indexer-enumerated set of our
 * collections' members) AND held by the wallet IS an owned skill — a set intersection
 * of two lists we can get cheaply (no per-asset on-chain read). The caller may pass a
 * catalog it has already fetched (e.g. getAgentProfile's search results) to avoid a
 * second indexer round-trip. This avoids the old per-asset getParsedAccountInfo
 * fan-out across ALL holdings (an unbounded concurrent RPC fan-out that 429'd the
 * agent-directory view).
 *
 * Gap rescue: the catalog is the indexer's projection, and for our Token-2022
 * TokenGroup mints DAS under-reports group membership, so the indexer can OMIT
 * current-collection skills the wallet genuinely holds. Any held mint the catalog
 * doesn't cover is verified on-chain via its TokenGroupMember `group` — the ground
 * truth (we deliberately do NOT trust DAS `grouping.group_value`, a synthetic id that
 * never equals the seed mint, verified on devnet) — and kept only if that group is one
 * of our CURRENT collections. Bounded by the catalog gap: zero extra RPC when the
 * catalog is complete, a few reads when it isn't.
 *
 * Returns [] if collections aren't configured (best-effort caller).
 */
export async function ownedSkillMints(owner: string, catalog?: Skill[]): Promise<string[]> {
  const { getSkillsCollectionMint, getWorkflowsCollectionMint, getIndexerUrl } = await import("./seed.js");
  const ours = new Set([getSkillsCollectionMint(), getWorkflowsCollectionMint()].filter(Boolean) as string[]);
  if (ours.size === 0) return [];

  const ownedIds = await ownedAssetIds(owner);
  if (ownedIds.size === 0) return [];

  // Fast path: a held mint that the catalog (collection members per the indexer)
  // also lists IS one of our skills — cheap, no per-asset on-chain read.
  let cat = catalog;
  if (!cat) {
    try { cat = await indexerSource(getIndexerUrl()).listSkills(); } catch { cat = undefined; }
  }
  const owned = new Set<string>();
  if (cat && cat.length > 0) {
    for (const s of cat) if (ownedIds.has(s.id)) owned.add(s.id);
  }

  // The catalog is the indexer's projection of our collections, and for our
  // Token-2022 TokenGroup mints DAS under-reports group membership, so the indexer
  // can MISS current-collection skills the wallet genuinely holds (issue: bought a
  // current-collection skill → it's absent from the catalog → dropped from "owned"
  // → its on-chain balance is real but the UI never offers that mint, so the
  // comment gate sees balance 0). Rescue them: any held mint NOT already matched is
  // verified on-chain against the CURRENT collections via its TokenGroupMember
  // group — the ground truth. Bounded by the catalog gap (0 RPC when the catalog is
  // complete), so the fast path's no-fan-out guarantee holds in the common case.
  const gap = [...ownedIds].filter((id) => !owned.has(id));
  if (gap.length > 0) {
    const rpcUrl = await resolveRpcUrl();
    const groups = await Promise.all(
      gap.map((id) => onChainGroup(rpcUrl, id).catch(() => null)),
    );
    gap.forEach((id, i) => { if (groups[i] && ours.has(groups[i]!)) owned.add(id); });
  }

  return [...owned];
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
  price: string | null; // lamports (decimal string) from the on-chain ItemConfig PDA
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
          price: it.price ?? undefined, // on-chain price (lamports); absent if unpriced
          supply: it.supply, // live — already hydrated by the indexer
          uriTxid: "",
          createdAt: 0,
        };
      });
    },
  };
}
