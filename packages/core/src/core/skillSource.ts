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
interface ParsedMintInfo {
  extensions?: { extension?: string; state?: { group?: string; updateAuthority?: string; name?: string } }[];
}

/**
 * Read the parsed Token-2022 mint accounts for many mints, aligned to the input
 * order. getMultipleAccounts takes up to 100 pubkeys per call, so this costs
 * ceil(N/100) round-trips instead of N. A per-mint getAccountInfo fan-out (the old
 * shape) blew past public-RPC rate limits — for a wallet holding 100+ NFTs it fired
 * ~90 concurrent calls, ~half of which 429'd and returned null, silently dropping
 * genuinely-held skills. One batched call is far faster and lossless.
 */
async function batchMintInfo(rpcUrl: string, mints: string[]): Promise<(ParsedMintInfo | null)[]> {
  const out: (ParsedMintInfo | null)[] = [];
  for (let i = 0; i < mints.length; i += 100) {
    const chunk = mints.slice(i, i + 100);
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: "1", method: "getMultipleAccounts",
        params: [chunk, { encoding: "jsonParsed" }],
      }),
    });
    const json = (await res.json()) as {
      result?: { value?: ({ data?: { parsed?: { info?: ParsedMintInfo } } } | null)[] };
    };
    const vals = json.result?.value ?? [];
    for (let k = 0; k < chunk.length; k++) out.push(vals[k]?.data?.parsed?.info ?? null);
  }
  return out;
}

/**
 * On-chain truth for collection membership: each mint's Token-2022 TokenGroupMember
 * `group` (the collection mint it was enrolled in). Ground truth — unlike DAS's
 * `grouping.group_value`, a synthetic id that never matches our seed.
 */
async function onChainGroups(rpcUrl: string, mints: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const infos = await batchMintInfo(rpcUrl, mints);
  infos.forEach((info, j) => {
    const group = (info?.extensions ?? []).find((e) => e.extension === "tokenGroupMember")?.state?.group;
    if (group) out.set(mints[j], group);
  });
  return out;
}

/**
 * Of the given mints, which belong to the official WORKFLOWS collection (by their
 * on-chain TokenGroupMember group — the ground truth). Used to keep workflows out of
 * a "pick your owned skills" picker: the publish contract rejects a required_skill
 * that is itself a workflow (NotInOfficialCollection), and locally-installed workflow
 * mints are otherwise indistinguishable from skill mints (the manifest records neither
 * a type). Best-effort: returns [] when the collection is unconfigured or the RPC read
 * fails, so callers degrade to "no filtering" rather than breaking.
 */
export async function workflowMintsAmong(mints: string[]): Promise<string[]> {
  const clean = [...new Set(mints.filter(Boolean))];
  if (clean.length === 0) return [];
  const { getWorkflowsCollectionMint } = await import("./seed.js");
  const workflows = getWorkflowsCollectionMint();
  if (!workflows) return [];
  const rpcUrl = await resolveRpcUrl();
  const groups = await onChainGroups(rpcUrl, clean).catch(() => new Map<string, string>());
  return clean.filter((m) => groups.get(m) === workflows);
}

/**
 * For the skills a wallet HOLDS (in our collections), each skill's on-chain creator
 * — the TokenMetadata `updateAuthority`, i.e. the publisher who minted it.
 *
 * This is the ground truth for "did this wallet buy/receive a skill that agent X
 * created", which the agent-comment gate and a profile's created-skills list both
 * need. The indexer catalog UNDER-REPORTS our Token-2022 members (it lists only a
 * subset of a creator's skills), so enumerating "agent X's skills" via
 * listSkills()∩creator misses skills X made that the holder genuinely owns — which
 * wrongly blocked legit commenters and hid self-published skills from a profile.
 * Reading the holder's OWN mints (always complete) + their on-chain creator avoids
 * the indexer entirely. One getTokenAccountsByOwner + one batched getMultipleAccounts.
 *
 * Returns mint → creatorWallet, restricted to our skill/workflow collections.
 */
export async function readHeldSkillCreators(owner: string): Promise<Map<string, string>> {
  const { getSkillsCollectionMint, getWorkflowsCollectionMint } = await import("./seed.js");
  const ours = new Set([getSkillsCollectionMint(), getWorkflowsCollectionMint()].filter(Boolean) as string[]);
  const out = new Map<string, string>();
  if (ours.size === 0) return out;
  const ids = [...(await ownedAssetIds(owner))];
  if (ids.length === 0) return out;
  const rpcUrl = await resolveRpcUrl();
  const infos = await batchMintInfo(rpcUrl, ids);
  infos.forEach((info, j) => {
    const exts = info?.extensions ?? [];
    const group = exts.find((e) => e.extension === "tokenGroupMember")?.state?.group;
    if (!group || !ours.has(group)) return; // only our skills
    const creator = exts.find((e) => e.extension === "tokenMetadata")?.state?.updateAuthority;
    if (creator) out.set(ids[j], creator);
  });
  return out;
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

// Briefly cache the full indexer catalog. ownedSkillMints (and thus ownedSkills) pulls the
// whole /items list (~1000) when the caller passes no catalog; repeated owned-skill reads in
// a short window (welcome panel + market + comment gate) would each re-fetch it. 30s is short
// enough that a newly published skill still surfaces quickly, and the on-chain gap-rescue in
// ownedSkillMints backstops anything a slightly-stale catalog misses.
let catalogCache: { at: number; skills: Skill[] } | null = null;
const CATALOG_TTL_MS = 30_000;
export async function cachedCatalog(): Promise<Skill[] | undefined> {
  const now = Date.now();
  if (catalogCache && now - catalogCache.at < CATALOG_TTL_MS) return catalogCache.skills;
  try {
    const { getIndexerUrl } = await import("./seed.js");
    const skills = await indexerSource(getIndexerUrl()).listSkills();
    catalogCache = { at: now, skills };
    return skills;
  } catch {
    return undefined;
  }
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
export async function ownedSkillMints(owner: string, catalog?: Skill[], heldIds?: Set<string>): Promise<string[]> {
  const { getSkillsCollectionMint, getWorkflowsCollectionMint } = await import("./seed.js");
  const ours = new Set([getSkillsCollectionMint(), getWorkflowsCollectionMint()].filter(Boolean) as string[]);
  if (ours.size === 0) return [];

  // A caller that already resolved the wallet's holdings (e.g. injectOwned via the cached
  // heldSkillMints) passes them in so this adds zero RPC on top of that read.
  const ownedIds = heldIds ?? (await ownedAssetIds(owner));
  if (ownedIds.size === 0) return [];

  // Fast path: a held mint that the catalog (collection members per the indexer)
  // also lists IS one of our skills — cheap, no per-asset on-chain read. When the caller
  // didn't hand us a catalog, use the briefly-cached full fetch instead of re-pulling ~1000
  // items on every owned-skills read.
  let cat = catalog;
  if (!cat) cat = await cachedCatalog();
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
    const groups = await onChainGroups(rpcUrl, gap).catch(() => new Map<string, string>());
    for (const id of gap) { const g = groups.get(id); if (g && ours.has(g)) owned.add(id); }
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
  // Read each mint's metadata with BOUNDED concurrency. Serial was one round-trip per owned
  // skill (slow for a full wallet); an UNBOUNDED fan-out 429s public RPC for large holdings
  // (the same trap batchMintInfo was built to avoid). 8-at-a-time is fast and rate-safe, and
  // processing batches in order keeps the output in mint order.
  const CONCURRENCY = 8;
  const out: { id: string; name: string; description?: string }[] = [];
  for (let i = 0; i < mints.length; i += CONCURRENCY) {
    const results = await Promise.all(
      mints.slice(i, i + CONCURRENCY).map(async (id) => {
        try {
          const md = await readSkillMintMetadata(conn, id);
          return md ? { id, name: md.name, description: md.description } : null;
        } catch {
          return null; // skip a mint we can't read rather than failing the whole list
        }
      }),
    );
    for (const r of results) if (r) out.push(r);
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
  stars?: number; // summed GitHub stars per skill (issue #89); absent on an older indexer
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
          stars: it.stars ?? 0, // summed GitHub stars (issue #89), 0 on an older indexer
          uriTxid: "",
          createdAt: 0,
        };
      });
    },
  };
}
