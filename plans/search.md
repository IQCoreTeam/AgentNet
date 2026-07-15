# Skill & Agent Search

> Sibling: [`00-overview.md`](00-overview.md) · [`skill-nft-structure.md`](skill-nft-structure.md)
> · [`actions-and-adapters.md`](actions-and-adapters.md) (`browseSkills` / `listAgents`).
> How search works: exact/keyword + hashtags/categories (as NFT traits) + an optional
> semantic layer that gives the "hotdog → 7-Eleven" leap.

---

## 0. The problem

Plain **exact / substring matching is not enough**. Searching "hotdog" should still surface
a 7-Eleven skill even though the word "hotdog" isn't in it — that's *semantic* match by
meaning.

The NFT structure makes this simple: search is a **short pipeline over on-chain fields**
(traits + `supply`), with semantic doing only the light job of mapping a query onto an
existing category/hashtag. No heavy ranking engine.

Because the NFT structure already holds the signals, search is a **simple pipeline**, not a
heavy ranking engine:

```mermaid
flowchart LR
    Q["query"] --> SEM["semantic: map query → category/hashtag<br/>(e.g. 'hotdog' → #convenience-store)<br/>+ keyword match on name"]
    SEM --> FILT["filter the one collection<br/>by that category/trait"]
    FILT --> SORT["sort by supply (mint count)<br/>= most-minted first"]
    SORT --> R["results + ⚠️ 'verify before you buy' note<br/>(buyer's agent runs a verify skill)"]
    style SORT fill:#cfc,stroke:#3a3
    style R fill:#ffd,stroke:#ca0
```

**The flow:** search the one collection → narrow by category/trait → sort by `supply`. The
heavy lifting is just reading on-chain fields (traits + supply). Semantic only does the
light job of mapping a vocabulary-mismatch query onto an existing category/hashtag — it does
**not** vector-compare every skill. Keyword handles exact name lookups.

---

## 1. The signals — and how each maps to NFT traits

> Search signals are pushed into the NFT structure as much as possible — collection,
> category, and hashtags become **NFT traits**.

| Signal | What | Where it lives | Gives |
|---|---|---|---|
| **collection** | the umbrella ("IQ Skills") | NFT collection | grouping |
| **category** | few fixed buckets (coding / design / research / writing…) | **NFT trait** | coarse filter, big drawers |
| **hashtags** | free, multi-label (`#json-parsing` `#convenience-store`) | **NFT trait(s)** | fine filter, search signal |
| **keyword** | words in name + description | skill text (code-in) | exact / substring |
| **embedding** | vector of the skill's meaning | off-chain index (§3) | semantic leap |

Because category + hashtags are **NFT traits** (Token-2022 `TokenMetadata`), they're
on-chain, permanent, and filterable the same way the marketplace filters skills (see
[`skill-nft-structure.md`](skill-nft-structure.md)). `browseSkills` (in
[`actions-and-adapters.md`](actions-and-adapters.md)) splits by these traits.

### category vs hashtag — they're complementary
- **category** = a small fixed set, one big drawer per skill (also the NFT trait used for browsing).
- **hashtags** = many free labels per skill, the fine-grained search signal.
- A raw query like "hotdog" might not match any tag directly — semantic bridges that by
  mapping the query onto the nearest existing category/hashtag (§3), then we filter+sort
  normally. So semantic is a thin **query→trait mapper**, not a full-corpus vector search.

---

## 2. Keyword/hashtag vs embedding — the actual difference

| | Keyword + hashtags | Embedding semantic |
|---|---|---|
| Matches | shared **words** / tags | shared **meaning** (no common words needed) |
| "hotdog" → "7-Eleven" | only if tagged | ✅ yes |
| typo / synonym / abbreviation | ✗ (unless dictionary) | ✅ tolerant |
| precision / determinism | ✅ high | 🔶 fuzzy (re-rank to fix) |
| cost | $0 | ~$0 at our scale (§3) |
| best for | "name a thing" | "describe a need" |

**Rule of thumb (by catalog size):**
- Hundreds of skills → keyword + good hashtags is plenty.
- Low thousands → ~10k → **hybrid is the sweet spot** (keyword/tags for precision,
  embedding as fallback/re-rank for intent queries).
- Embeddings start *mattering* once people search by intent and browsing breaks down.

→ **Ship keyword + hashtags(as NFT traits) first; add embedding as a hybrid fallback.**

---

## 2b. Agent search — same data, different read

Searching *agents* (not skills) reuses the exact same on-chain data:

```mermaid
flowchart LR
    A["agent query"] --> H["pull all holders of the collection<br/>(DAS getTokenAccounts)"]
    H --> MATCH["match holders ↔ creator info<br/>(who minted which skills)"]
    MATCH --> RANK["rank by their skills' total supply<br/>= creators of popular skills rise"]
    style RANK fill:#cfc,stroke:#3a3
```

- **Holders of the collection** = the ecosystem user list (one DAS read).
- A wallet that **created** skills with high total `supply` ranks higher → "famous agent."
- No separate agent registry — agents emerge from "who minted skills that people minted."

---

## 2c. Result display — verify before you buy (reader-side)

In the results view (per [`actions-and-adapters.md`](actions-and-adapters.md) adapters):
- **There is no on-chain audit / Q-table.** Skill safety is **not** an official
  admin eval recorded on-chain — publishing stays permissionless and a green
  badge can't be forged because there's no badge.
- **Safety is verified reader-side, before buying.** The buyer's own agent runs a
  **"verify" skill** over the candidate skill's text (a normal skill in the net,
  dogfooding the model) and decides whether to proceed. The buyer's agent — the
  party with skin in the game — is the gate, not a central authority.
- **Always show a ⚠️ "verify before you trust" note.** Search ranks by `supply`
  (does it sell?) and creator reputation; those are signals, not guarantees, so
  the buyer/agent checks the skill before equipping it.

---

## 3. How to do embedding semantic — and the cost/ops reality

> Does embedding semantic search cost more / require a model running 24/7? **No idle cost,
> no always-on model.** It's pay-per-call (pennies) + a few MB of storage. (2025–2026
> pricing; sources at bottom.)

**Even lighter for us:** we mainly embed the *category/hashtag list* (a tiny fixed set) and
match the query against it — not every skill. So the index is a handful of vectors, and the
per-query cost is one tiny embedding call. Full-corpus embedding is optional, only if we
later want skill-level semantic ranking beyond category mapping.

**Two phases, neither needs a running model:**

```mermaid
flowchart TB
    subgraph Index["① Indexing — once, at publish"]
        P["skill published"] --> E1["embed its ~200 tokens (1 API call)"] --> V["store vector (~1.5–6 KB)"]
    end
    subgraph Query["② Query — per search"]
        QS["user query"] --> E2["embed query (1 API call, ~$0.0000006)"] --> COS["cosine vs stored vectors (in-memory)"] --> R["ranked results"]
    end
    style Index fill:#eef,stroke:#33c
    style Query fill:#eef,stroke:#33c
```

**Cost facts (for ~10k skills ≈ 2M tokens):**
- Embed whole corpus **once**: text-embedding-3-small **$0.02/1M → ~$0.04 (4 cents)**;
  Voyage lite has a **200M-token free tier → $0**; self-hosted MiniLM/bge-small (CPU) → **$0**.
- Per search: **~$0.0000006** (a million searches ≈ $0.60).
- **Idle / always-on cost: $0** — stateless API calls, no GPU, no monthly minimum.
- Vectors are tiny: 384-dim = ~1.5 KB; 10k skills ≈ **15 MB** → just hold in memory.
- **No vector DB needed** at ≤10k–100k: brute-force in-memory cosine is sub-millisecond.
  (ANN index / vector DB only matters past ~50k–100k.)

**What to AVOID (these are the only things with idle cost):**
- ❌ Dedicated/reserved embedding instances (e.g. hourly model rental) — billed 24/7.
- ❌ Hosted vector DBs with monthly minimums (e.g. Pinecone Standard $50/mo) — unnecessary here.
- ❌ A *separate* always-on box just to host a small model — if self-hosting, embed inside
  the existing backend so marginal cost ≈ $0.

**Cheapest viable setup:**
1. Embed with `text-embedding-3-small` ($0.02/1M) **or** Voyage lite (free tier) **or**
   self-host MiniLM/bge-small on CPU ($0).
2. Store vectors as a column in the DB/cache we already have (or sqlite-vec).
3. Search = in-memory cosine scan. No vector DB.

---

## 4. Where it runs

Same `CacheLayer` abstraction as `listAgents` ([`actions-and-adapters.md`](actions-and-adapters.md) §4):
the keyword + trait filter can run on-chain/gateway reads; the embedding index is an
off-chain side index (cheap to rebuild).

> **Decided / built (since):** the keyword + trait filter + supply sort now runs in a
> **separate backend** — the `agentnet-nft-indexer` repo (DAS scan → SQLite). The SDK
> reaches it via `indexerSource(baseUrl)` (a `hydrated` `SkillSource`) and falls back to
> `dasSource` (direct DAS scan) when it's unreachable. The **embedding/semantic** layer
> below is still unbuilt (the "later" half). So: keyword + category/hashtag + supply =
> built; semantic query→category mapping = not yet.

```mermaid
flowchart LR
    SEARCH["search action"] --> CL{{"CacheLayer (abstract)"}}
    CL --> KW["keyword + trait filter<br/>(on-chain / gateway)"]
    CL --> EMB["embedding index<br/>(off-chain, rebuildable)"]
    KW --> MERGE["hybrid merge / re-rank"]
    EMB --> MERGE
    style CL fill:#fff7e6,stroke:#ca0
```

---

## 5. Build order

1. ✅ Skill search pipeline: keyword on name + **category/trait filter → sort by `supply`**
   (the §0 flow). Shipped — see the §4 "Decided / built" note (`agentnet-nft-indexer` +
   `packages/core/src/search/`).
2. ✅ Result view: **reader-side verify before buy** — shipped as a hard gate:
   `verify_skill` (agent judges against `VERIFY_RUBRIC`) + `scanSkillText`, and
   `VerifyGuard` blocks `buy_skill` until verified (`packages/core/src/skill-market/`).
3. ⬜ **Agent search** (§2b): collection holders → match creators → rank by their skills'
   total `supply`.
4. ⬜ Semantic query→category mapper (embed the small category/hashtag set; map the query
   onto it). Optional full-corpus embedding only if needed later.

## 6. Open decisions

- **Embedding provider** — pay-per-call API (3-small / Voyage free) vs self-host MiniLM/bge
  in the existing backend. Both have ~$0 idle; pick by deployment preference.
- **Hybrid merge** — how to combine keyword score + cosine (weighted? keyword-first then
  semantic fallback?).
- **Re-embed trigger** — only when skill text changes (cheap), or periodic.
- **Trait schema** — exact category list + hashtag rules, tied to the NFT trait design.

---

> **Sources (embedding cost/ops, 2025–2026):** OpenAI embeddings pricing (text-embedding-3-small
> $0.02/1M), Voyage AI pricing (200M free tier), Cohere pricing, Pinecone pricing (Starter
> free / Standard $50 min), sentence-transformers all-MiniLM-L6-v2 model card (CPU, 384-dim,
> ~90MB), pgvector vs Pinecone, sqlite-vec. (Per-query embedding ≈ $6e-7; 10k corpus ≈ 4¢;
> idle cost = $0 with pay-per-call.)
