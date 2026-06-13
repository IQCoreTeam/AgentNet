# Skill NFT — on-chain data format (decided with zo, 2026-06-13)

> The shape a skill takes on-chain: what lives on the mint, what the `uri` points
> at, and what JSON the content inscription holds — chosen so search, minting,
> publishing, and `supply`-ranking all wire off **one** shape.
> Builds on [`../skill-nft-structure.md`](../skill-nft-structure.md) (why Token-2022
> + code-in) and [`../search.md`](../search.md) (trait filter + supply sort).
>
> Every line below is a **decision reached in discussion**, not a default. The
> rationale for each is in §"Why" so we don't re-litigate later.

---

## 0. The two places a skill's data lives

A skill is fully on-chain, in two layers. The format is "what goes where":

```
① Token-2022 Mint (on-chain, permanent) ── source of truth
     name · symbol · uri(=code-in txid) · supply(=popularity)
                           │ uri = txid
                           ▼
② code-in inscription = ONE standard NFT JSON (on-chain content)
     { name, image?, description, attributes[], skillText }
```

Enumeration ("which skills exist") is a **DAS scan of the Token-2022 collection**
— the mint is the registry, nothing is mirrored off-chain. Reading is direct:
`searchSkills` scans the collection, reads each mint's `supply` to sort and the ②
JSON `attributes` to filter.

> We do **not** design any off-chain index/cache layer into this structure. When
> we eventually want marketplace-grade search, we'll follow whatever model NFT
> marketplaces use *then* — so the on-chain format must stand on its own without
> assuming an indexer exists. Keep that concern out of this doc.

---

## 1. ① The mint (Token-2022 TokenMetadata)

| Field | Value | Notes |
|---|---|---|
| `name` | `"clean-code-refactor"` | display title |
| `symbol` | `"CLEAN-CO"` | short tag (name[:8] upper) |
| `uri` | **code-in txid** | NOT a URL — points at the ② inscription |
| `supply` | live counter, +1 per buy | **the ranking signal** (read from the mint) |

**`additionalMetadata` is NOT used to carry traits.** (PR #4 currently puts
`category`/`hashtags` there — we move them into the ② JSON instead. See §4.)

**Why:** keeping `uri = txid` preserves the IQ6900 / fully-on-chain model
([`../skill-nft-structure.md`](../skill-nft-structure.md) §2). `supply` as the
sort key is fixed by [`../search.md`](../search.md) §0 — and **no external API
sorts by it**, so we always rank ourselves.

---

## 2. ② The content inscription = one standard NFT JSON

The code-in `data` payload is a **single JSON in the standard NFT shape**, with
one extension field (`skillText`) for the body:

```jsonc
{
  "name": "clean-code-refactor",
  "image": "<txid | https://….png | omitted>",   // optional — see §3
  "description": "Refactor toward clean, testable code.",
  "attributes": [                                  // standard trait schema — see §4
    { "trait_type": "category", "value": "clean-code" },
    { "trait_type": "skill",    "value": "refactoring" },
    { "trait_type": "skill",    "value": "testing" }
  ],
  "skillText": "# Clean Code Refactor\n…full SKILL.md body…"   // our extension
}
```

- `name` / `image` / `description` / `attributes` = **exactly the standard NFT
  JSON fields** a marketplace JSON would have.
- `skillText` = our addition — the actual SKILL.md body the agent runs. Folded
  into the same JSON so one code-in read returns everything.

**Why a standard-shaped JSON even though we don't list on marketplaces:** so the
content is readable with **zero translation** by any tool that already understands
NFT JSON — a future marketplace, a future indexer of ours, anyone's. We adopt the
*schema* now (it costs nothing) and stay free to add marketplace-grade search
later by following whatever model marketplaces use then. We do **not** build or
assume any indexer here — search today is a direct DAS collection scan (§0).

---

## 3. ③ Image — optional, on-or-off-chain, no flag

`image` is optional. **Its value's shape says where it lives** — we do NOT add an
`isOnchain` boolean:

| `image` value | Means | Viewer |
|---|---|---|
| ends `.png/.jpg/.gif/.webp/.svg` or starts `http` | off-chain URL | render directly |
| a txid / PDA-looking base58 string | on-chain (code-in base64 image) | decode via gateway |
| absent | none | render a **default "skill document" image** (viewer asset) |

**Why:** zo — "txid/PDA가 아니거나 `.png` 등으로 끝나면 알아낼 수 있으니 따로
`is onchain` 필드 만들지 말고 단순하게." Missing image must never block a card,
so the default is a viewer-side fallback.

---

## 4. Traits — standard `attributes`, inside the ② JSON

category + hashtags become the standard `attributes` array (not on-chain
`additionalMetadata`, not separate keys):

- **`category`** → one `{trait_type:"category", value:…}` (single slot, like a
  PFP's "Hat").
- **hashtags** → one `{trait_type:"skill", value:…}` row **per tag** (repeat the
  `trait_type` for multi-value, the standard way — like several "모자/옷" rows).
- **`creator` is NOT a trait** — it's recoverable directly as the mint's update
  authority, so it never needs to be a stored trait. zo: "creator는 말고."

**Why this schema, here:** zo chose "표준 attributes로 code-in JSON 안에." It's the
exact `{trait_type, value}` shape every NFT tool already understands, so anything
that later reads the JSON gets the traits for free. Traits sit in the ② JSON (not
the mint's `additionalMetadata`) because that's where the standard NFT shape keeps
them. Filtering today is a direct read of these `attributes` after the DAS scan.

---

## 4b. Workflow NFT — same JSON, one extra trait

A **workflow** is the exact same Token-2022 + code-in shape as a skill (same ②
JSON, same `name/image/description/attributes/skillText`), in its **own
collection** so search can tell the two apart
([`../workflow-nft.md`](../workflow-nft.md) §1). The only addition is the
prerequisite list, carried as a repeated trait:

```jsonc
{
  "name": "trading-workflow",
  "image": "<txid | url | omitted>",
  "description": "Fetch → analyze → trade.",
  "attributes": [
    { "trait_type": "category",      "value": "trading" },
    { "trait_type": "skill",         "value": "automation" },
    { "trait_type": "requiredSkill", "value": "7xKq…9fРa" },   // skill NFT id (mint addr)
    { "trait_type": "requiredSkill", "value": "9aBc…3dEf" }    // one row per required skill
  ],
  "skillText": "…the workflow recipe…"
}
```

- **`requiredSkill`** → one row **per required skill**, same repeated-`trait_type`
  multi-value pattern as `skill` tags.
- The value is the required skill's **NFT id = its mint address**, NOT its name.
  An id points at exactly **that one item** — no collection, no ambiguity, no
  other info needed. Names can collide or change; the mint address is unique and
  permanent. This is what the unlock gate checks and what discovery matches.

**Why id, not name (zo):** "required skills에 이름 같은 이상한 값 넣지 말고 그
스킬의 NFT id를 담자 — 컬렉션도 아니고 딱 그 아이템을 가리킬 수 있게, 다른 정보
필요 없이." The unlock gate is "do I hold every `requiredSkill` mint?" — a direct
id-set check ([`../workflow-nft.md`](../workflow-nft.md) §2). Discovery
("unlockable / almost-there") is the same id-set compare against my held skill
mints (§3 there). Both are trivial because the trait is already the mint id.

> A skill does **not** carry its own id as a trait — the NFT id *is* the mint
> address, already known from the DAS scan result. Only `requiredSkill` needs an
> id, because it references *another* item.

---

## 5. `uri = txid`, kept pure — no gateway URL baked in

`uri` holds the **code-in txid**, never a gateway URL.

**Why not bake a gateway URL into `uri`:** decided against (zo). A URL in `uri`
pins a gateway domain into the permanent mint (centralization / breaks if the
domain moves), and the external-API upside is near-zero (soulbound = not listed;
no public API sorts by `supply`/attributes anyway). `uri = txid` keeps the mint
pure. Anything that later wants a `…/skill/<txid>.json` URL can produce it from the
txid on demand — but that's a future serving concern, deliberately **not** part of
this on-chain format. We don't design it in now.

---

## 6. Decisions captured here (so we don't redo them)

1. `uri = code-in txid` (on-chain pure) — never a gateway URL.
2. Content inscription = one **standard NFT JSON** (`name/image/description/
   attributes`) + `skillText` extension.
3. `image` optional; on/off-chain inferred from the value's shape; absent →
   default image. No `isOnchain` flag.
4. Traits = standard `attributes` (`category` single, `skill` repeated per tag),
   inside the JSON. `creator` is a field, never a trait.
5. Enumeration = **DAS scan of the Token-2022 collection**; sort by `supply`,
   filter by `attributes` — read directly, no index/cache layer designed in.
6. **No off-chain index / gateway / marketplace model designed into this format.**
   The structure stands alone on-chain; marketplace-grade serving is a later
   concern, built then by following whatever model marketplaces use at that time.
7. Workflow NFT = same ② JSON in its own collection; `requiredSkill` = one
   repeated trait per prerequisite, valued by the skill's **NFT id (mint addr)**,
   not its name (§4b).

## 8. Still open (not decided — carry forward)

- **`skillText` in the JSON vs a separate field** — folded in here for one-read
  simplicity; revisit if SKILL.md bodies get large (code-in chunk thresholds:
  inline ≤700B, chunk @850B).
- **Default image asset** — what the "skill document" fallback actually looks
  like (viewer concern).
