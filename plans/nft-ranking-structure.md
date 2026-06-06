# NFT Ranking Structure — 🚧 TODO / Research stage

> Sibling: [`skill-soulbound-structure.md`](skill-soulbound-structure.md).
> Design for ranking popular skills / famous agents by NFT mint count.
> **Not decided yet.** For now this only captures our NFT-type research state.

---

## 0. Purpose of this doc

What the skill-soulbound doc deferred as "ranking → separate doc":
- Popular-skill ranking = **NFT mint count** (= `SkillOwnership` PDA / NFT mint count)
- Famous-agent ranking = e.g. sum of mint counts across the skills that agent created

**Core question:** with **which NFT standard** do we accumulate the mint count, and **how
do we count it** (on-chain vs gateway)? This decides the collection structure. Below are
the research-verified facts — the decision is still TODO.

---

## 1. Research results — collection structure options (verified facts)

> Source: official mpl-core / mpl-token-metadata / Token-2022 docs.
> **Conclusion: Solana has no native "nested collection" (collection-in-collection).**
> Owner count is **always off-chain aggregated** under any standard.

### Option A: single mpl-core collection + skillId attribute
- One `IQ Skills` collection holds all skill NFTs, distinguished by a `skillId` attribute.
- **Soulbound**: `PermanentFreezeDelegate` once at the **collection level** → all auto
  non-transferable. ✅
- **Source-repo registration**: native via mpl-core `AppData`/`LinkedAppData` plugin. ✅
- **Mint-count ranking**: no per-skill count on-chain → gateway aggregates off-chain via DAS.
- **Same stack as IQ6900** (mpl-core) → reuse code/patterns. ✅
- New skill = mint 1 NFT (cheap).

### Option B: skill = Master Edition (mpl-token-metadata)
- One verified collection umbrella, each skill = a **Master Edition**, purchase = Print Edition.
- **Mint count on-chain for free**: `MasterEdition.supply: u64` auto-increments per print. ✅
  (But this is mint count, **not owner count** — one wallet holding several counts as several.)
- **Soulbound**: needs freeze per print (more hands-on than A).
- **No source-repo (AppData)** → needs a separate IQLabs table.
- New skill = **create a master account** (pricier/heavier than A).
- token-metadata (older standard) → different stack from IQ6900 (mpl-core).

### Verified key facts
- mpl-core's `MasterEdition`/`Edition` plugins are **"informational only, no counting".**
  The ones that give an on-chain counter are **mpl-token-metadata's `MasterEdition.supply`**
  or **Token-2022 `TokenGroup.size`** — both flat (beside the umbrella, not truly nested).
- **Owner count** (unique owners) is not native on-chain under any standard → always off-chain.
- DAS `getAssetsByGroup` groups **only by collection** → skillId-attribute aggregation is our
  code (gateway).
- Token-2022 group/member self-nesting isn't explicitly forbidden but is **undocumented/not
  recommended** → treat as a hack.
- Compressed NFTs (Bubblegum) aren't a grouping hierarchy (storage scaling).

---

## 2. A vs B comparison (verified)

| Item | A: single mpl-core collection | B: skill = Master Edition |
|---|---|---|
| Standard | mpl-core (newest, rich plugins) | mpl-token-metadata (older, mature) |
| Umbrella grouping | one collection ✅ | one verified collection ✅ |
| Mint-count ranking | ⚠️ gateway off-chain (DAS) | ✅ `master.supply` on-chain free |
| Soulbound | ✅ once at collection level | ⚠️ per print |
| Source-repo (AppData) | ✅ native | ❌ separate IQLabs table |
| New-skill minting | 1 NFT (cheap) | create master account (pricey) |
| IQ6900 compat | same stack ✅ | different stack |
| Owner-count counting | off-chain | off-chain (supply is mint count) |

**Tentative lean (undecided):** Option A. B's only advantage (mint count on-chain) is
something the gateway does anyway, while A's advantages (native source-repo, soulbound in
one go, same stack as IQ6900) are the features we actually need.
→ **But final decision is TODO.**

---

## 3. TODO (not done yet)

- [ ] **Final A vs B decision** — based on the table above.
- [ ] Define the mint-count → popularity-score **formula** (total mints vs paid-mint weighting).
- [ ] **Famous-agent** score — sum of that agent's skill mint counts? followers? cumulative revenue?
- [ ] **Sybil resistance** — block inflating mint count via free bot mints (make free mints costly, etc.).
- [ ] Gateway aggregation method — DAS scan cadence/cache, per-`skillId` owner count.
- [ ] If an on-chain counter is truly needed, whether to adopt part of B (hybrid).
