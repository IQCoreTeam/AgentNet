# Workflow NFT

> Sibling: [`skill-nft-structure.md`](skill-nft-structure.md) (reuses its Token-2022 pattern) ·
> [`search.md`](search.md) (same search/sort). A **workflow** is a recipe of skills; unlocking
> it (game-style) requires owning the needed skills, and mints a workflow NFT.

---

## 0. What a workflow is

A **skill** is one ability. A **workflow** is a *recipe* combining several skills into a job.

> Example — a **trading** workflow needs: a **fetch/lookup** skill + an **analysis** skill +
> a **buy/sell** skill. Owning all three lets you unlock the trading workflow.

Game-style: a workflow shows *"to unlock this you need [fetch] [analyze] [trade]"*; press
**Unlock** and — only if you hold those skills — a **workflow NFT** is minted to you.

```mermaid
flowchart LR
    WF["🧩 Trading workflow<br/>requires: fetch · analyze · trade"]
    WF --> Q{"do I hold all<br/>required skills?"}
    Q -->|yes| UNLOCK["✅ Unlock → mint workflow NFT"]
    Q -->|no| LOCKED["🔒 locked — shows what's missing"]
    style UNLOCK fill:#efe,stroke:#3a3
    style LOCKED fill:#fee,stroke:#c33
```

---

## 1. Same pattern as skills, separate collection

A workflow NFT reuses the **exact Token-2022 semi-fungible pattern** from
[`skill-nft-structure.md`](skill-nft-structure.md) — only in its **own collection** (so
search can tell skills and workflows apart):

| | Skill collection | Workflow collection |
|---|---|---|
| token | Token-2022 mint per skill | Token-2022 mint per workflow |
| soulbound | `NonTransferable` | `NonTransferable` |
| popularity | `mint.supply` | `mint.supply` |
| content (`uri`) | code-in skill text | code-in workflow definition (the recipe) |
| **traits** | category, hashtags | category, hashtags **+ requiredSkills** |

The key extra trait: **`requiredSkills`** = the list of skill mint addresses the workflow
needs. This one trait drives both the gate (§2) and discovery (§3).

```mermaid
flowchart TB
    WMINT["🪙 workflow = Token-2022 mint (own collection)"]
    WMINT --> SUP["supply = popularity"]
    WMINT --> NT["NonTransferable = soulbound"]
    WMINT --> REQ["trait: requiredSkills = [skillMintA, skillMintB, …]"]
    WMINT --> URI["uri → code-in workflow recipe"]
    style WMINT fill:#efe,stroke:#3a3,stroke-width:2px
    style REQ fill:#cfc,stroke:#3a3
```

---

## 2. Unlock = gated mint (must hold the required skills)

> **Gate: you must actually hold the required skills to unlock.**

`unlock_workflow` is one atomic tx, like `buy_skill` but with a **prerequisite check**:

```mermaid
sequenceDiagram
    actor U as User (agent wallet)
    participant TX as Single transaction
    participant P as Program
    participant C as Creator / IQ

    U->>TX: unlock_workflow(workflowId)
    TX->>P: check wallet holds every requiredSkills token
    alt missing a required skill
        P-->>U: 🔒 reject — "need skill X"
    else holds all
        opt price > 0
            TX->>C: transfer (creator + iqfee)
        end
        TX->>P: mint 1 NonTransferable workflow token (supply++)
        P-->>U: ✅ workflow unlocked & soulbound
    end
```

- The prerequisite is verified **on-chain** (the wallet holds each `requiredSkills` mint) —
  same kind of token-holding check notes use to gate comments.
- Unlock = `star = pay = equip` unified, exactly like skills (free = price-0).
- So owning a workflow proves "this agent has the full skill set for this job."

---

## 3. Discovery — "what can I unlock?" is free

Because `requiredSkills` is a **trait**, the game-style views come from the same search
pipeline ([`search.md`](search.md)), no extra system:

- **Browse workflows** by category/hashtag, sort by `supply` (popular first).
- **"Workflows I can unlock"** = filter where my wallet holds *all* `requiredSkills`.
- **"Almost there"** = workflows where I'm missing only 1 required skill → suggests which
  skill to buy next (natural funnel back into the skill market).

```mermaid
flowchart LR
    Me["my held skills"] --> F{"for each workflow:<br/>requiredSkills ⊆ mine?"}
    F -->|all held| Unlockable["✅ unlockable now"]
    F -->|missing some| Locked["🔒 shows missing skills<br/>→ go buy them"]
    style Unlockable fill:#efe,stroke:#3a3
```

This is computed front-end / cache (per [`search.md`](search.md) — sort/filter on the
client over data pulled via RPC/gateway). No new backend.

---

## 4. Relationship to skills (a layer on top)

```mermaid
flowchart TB
    SK["skills (abilities)"] --> WF["workflows (recipes of skills)"]
    WF --> AG["agent profile shows both:<br/>skills owned + workflows unlocked"]
    style WF fill:#efe,stroke:#3a3
```

- Workflows sit **on top of** skills — they don't replace them, they bundle them.
- An agent's profile then shows **skills owned + workflows unlocked** (both are
  soulbound tokens the wallet holds).
- The workflow recipe (code-in text at `uri`) is the actual orchestration the runtime
  follows once unlocked (how the skills chain together for the job).

---

## 5. Build order (after skill NFT)

1. ⬜ Workflow collection (Token-2022, same pattern as skills) + `requiredSkills` trait.
2. ⬜ Publish: code-in the workflow recipe → mint into the workflow collection.
3. ⬜ `unlock_workflow` — prerequisite check (holds all requiredSkills) + atomic mint.
4. ⬜ Discovery: "unlockable / almost-there" filters (front-end over search pipeline).
5. ⬜ Runtime: once unlocked, follow the recipe to chain the skills.

## 6. Open decisions

- **requiredSkills granularity** — exact skill mints, or "any skill in category X"? (exact
  is simplest; category-level is more flexible but fuzzier to verify on-chain).
- **Recipe format** — what the code-in workflow text actually encodes (ordered steps? a
  graph? which skill at each step).
- **Versioning** — if a required skill updates, does the workflow break / need a re-mint?
- **Price model** — free unlock vs paid (creator earns); same `iqfee` question as skills.
- **Nested workflows** — can a workflow require another workflow (not just skills)? Keep
  flat for v1 unless needed.
