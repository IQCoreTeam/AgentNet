# AgentNet tables — on-chain table structure (decided with zo, 2026-06-13)

> The full list of IQLabs tables under the `agentnet-root` DbRoot: every table,
> its key (seed hint), what it holds, and who may write. Sibling to
> [`skill-nft-json.md`](skill-nft-json.md) (the NFT *content* format) — that doc
> owns "what a skill IS as an NFT", this doc owns "what we store in IQLabs tables
> around it".
> Builds on [`../00-overview.md`](../00-overview.md) §1 (the grand map) and
> [`../coding-info.md`](../coding-info.md) §B (source layout).
>
> Every row below is a **decision reached in discussion**, not a default. Live in
> `packages/core/src/core/seed.ts` (the single source of truth for hints), pushed
> to PR #4 branch as `501ac84`.

---

## 0. The whole list (this is all of it)

Under one DbRoot — **`agentnet-root`** — there are exactly these tables. The NFT
mints themselves are NOT tables (the Token-2022 collection IS the registry; see
[`skill-nft-json.md`](skill-nft-json.md) and [`../skill-nft-structure.md`](../skill-nft-structure.md) §2).

| Table (seed hint) | Key | Holds | Writers |
|---|---|---|---|
| `mysessions:{wallet}` | wallet | session **pointer** list (sessionId), not the blob | owner only |
| `reviews:{collectionId}:{nft}` | collection mint + item mint | comments on a skill/workflow item | (gate §3) |
| `reviews:agent:{wallet}` | agent wallet | comments on an agent + the owner's self-notes (blog) | (gate §3) |

That's the entire table surface. The hint strings are produced by functions in
`seed.ts`: `mysessionsHint(wallet)`, `reviewsHint(collectionId, nft)`,
`reviewsAgentHint(wallet)`.

> No `audit` table. Skill safety is **not** an admin/QAgent eval written on-chain
> — it's verified **reader-side**: before buying, the buyer's own agent runs a
> "verify" skill over the candidate. Publishing stays permissionless; trust is the
> buyer's call, not a gated official record. (Replaces the earlier Q-table model.)

---

## 1. The key idea — collection is the umbrella, item is under it

`reviews` are keyed by **collection THEN item**, not item alone.

```
collection (the umbrella)          item (under it)
  ┌─ skills collection mint ──┬── skill NFT mint ── reviews:{skillsColl}:{skillNft}
  │                           └── skill NFT mint ── reviews:{skillsColl}:{skillNft}
  └─ workflows collection ────┬── workflow NFT ──── reviews:{wfColl}:{wfNft}
                              └── …
```

- **`collectionId`** = the umbrella collection mint (skills / workflows / a future
  kind). zo: "컬렉션은 skills or workflow or 미래에 들어갈 수 있는 다른 우산이고,
  mint는 그 안에 각각 다른 아이템들이 스킬이 되는 것."
- **There are only two collections today** (skills, workflows). The mapping
  "item type → collection mint" is hardcoded in **one place** —
  `collectionFor(type)` in `seed.ts` (reads the configured collection pubkeys). A
  new umbrella adds a branch there, nowhere else. zo: "이건 어디 중앙화된 곳에
  하드코딩할 준비를 해라."

**Why key by collection THEN item** (the item mint is already unique): it
partitions reviews per umbrella, so adding a new collection kind extends the same
table shape instead of inventing a new one.

> Note: `reviews:agent:{wallet}` has no collectionId — an agent is a wallet, not
> an item under a collection. The literal `agent` segment keeps it from colliding
> with a collection mint key.

---

## 2. What changed from PR #4's original tables

PR #4 (mega123-art) shipped a different set; we settled it down to the list in §0.

| PR #4 original | Now | Why |
|---|---|---|
| `notes:skill:{nft}` · `notes:agent:{wallet}` | `reviews:{collectionId}:{nft}` · `reviews:agent:{wallet}` | renamed notes→reviews; added the collection umbrella to the item key |
| `audit:skills` (fixed string) | **removed** | no on-chain audit table — safety is reader-side verify before buy (§0) |
| **`skills:index`** (cache table) | **removed** | the mint IS the registry; enumeration = DAS collection scan (§4) |
| **`reputation:{wallet}`** (snapshot) | **removed** | reputation was never stored — it's derived live (§5) |

`NOTE_COLUMNS` → `REVIEW_COLUMNS` (same shape: id · author · text · gitLink? ·
timestamp · meta?). `REPUTATION_COLUMNS` / `SKILLS_INDEX_COLUMNS` deleted.

---

## 3. Write gates (reviews)

Reviews are gated CLIENT-SIDE (the deployed IQ contract's native gate can't verify
a Token-2022 mint — its ATA derivation uses the legacy token program id, so a
natively-gated table rejects even legit Token-2022 holders). The functions enforce
it before `writeRow`:

| Review kind | Table | Who may write |
|---|---|---|
| comment on an item | `reviews:{collectionId}:{nft}` | holders of that item's soulbound token (`getBalance ≥ 1`) |
| comment on an agent | `reviews:agent:{wallet}` | holders of ≥1 of that agent's skills |
| self-note (blog) | `reviews:agent:{wallet}` | the wallet owner only (author == subject) |

self-note vs comment is **derived from `author == subject`**, not a stored flag
(notes.md §3). An attacker calling `writeRow` directly bypasses the client gate —
real on-chain enforcement waits on SDK Token-2022 ATA support.

---

## 4. No index table — enumeration is the DAS collection scan

There is **no `skills:index`** and no off-chain index/cache designed into the
structure at all (`501ac84`).

- "Which skills/workflows exist" = scan the Token-2022 **collection** via DAS
  `getAssetsByGroup` (`dasSource` in `core/skillSource.ts`, now the only + default
  `SkillSource`). The mint is the registry; nothing is mirrored into a table.
- `publishSkill` / `publishWorkflow` no longer write an index row — they just mint.
- Until the collections are minted on devnet (and a DAS provider is proven to index
  the Token-2022 group — see `scripts/probe-das-group.ts`), `searchSkills` returns
  an **empty list**. That's a real, visible state, not a hidden failure.

zo: "빈칸으로 만들어 — 걍 안 되면 고치면 됨." Marketplace-grade search (an off-chain
indexer) is a **later** concern, built then by following whatever model NFT
marketplaces use at that time — so we deliberately do **not** design any index
layer into this structure now. If one is ever added it sits behind the existing
`SkillSource` seam and is **never** an IQLabs table.

---

## 5. No reputation table — it's derived live

`reputation:{wallet}` and `updateReputation` are removed. An agent's standing was
never a stored score:

- **standing = `totalSupply`** = sum of `supply` across the skills that agent
  created (skill-nft-structure.md: "famous agent = sum of supply").
- `getReputation` / `getLeaderboard` compute this **on every read** — enumerate via
  `dasSource`, filter by creator, hydrate live `supply` from each mint, count
  reviews from `reviews:{collectionId}:{nft}`. Nothing to write, nothing to keep in
  sync.

zo: "민팅 수량이나 그런 걸 읽은 다음에 notes 등을 읽을 테니 — 따로 테이블을 두고
관리할 값은 아니다."

---

## 6. Decisions captured (so we don't redo them)

1. Tables under `agentnet-root` = **`mysessions`, `reviews:*`** — that's all.
2. `reviews` keyed by **collection THEN item**; `collectionId` = the
   umbrella collection mint. Only two collections (skills, workflows); the
   type→collection map is hardcoded in `collectionFor(type)` in `seed.ts`.
3. notes → **reviews** (rename). **No `audit` table** — skill safety is verified
   reader-side (buyer's agent runs a "verify" skill before buying), not an
   on-chain admin/QAgent record.
4. **No `skills:index`** — enumeration is the DAS collection scan (`dasSource`),
   the only `SkillSource`. The mint is the registry. Empty until collections mint.
5. **No `reputation` table** — derived live from mint `supply` + review counts.
6. Review write-gates are **client-side** token-holding checks (native gate can't
   verify Token-2022 yet).

## 7. Still open (carry forward)

- **DAS probe** — confirm a provider indexes the Token-2022 group under
  `getAssetsByGroup("collection")` before relying on `dasSource` for real
  (`scripts/probe-das-group.ts`). If DAS can't, the fallback is decided later
  (not designed in now).
- **Agent-comment gate** — "holds ≥1 of that agent's skills" requires enumerating
  the agent's skills (a `dasSource` scan per write); revisit cost when real.
