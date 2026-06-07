# AgentNet — Overall Architecture (start here)

> The map of how every piece fits. Read this first, then drill into each plan doc.
> Vision: [`../README.md`](../README.md) / [`../aboutkr.md`](../aboutkr.md).

---

## 1. The grand unified map — everything connected

The single map of the whole system: runtimes, the wallet identity, off-chain storage,
on-chain skills/ownership/reputation, the agent profile, validation, ranking, and the
economic loop — all in one.

```mermaid
flowchart TB
    %% ===================== TOP: RUNTIMES =====================
    subgraph Runtimes["🖥️ Runtimes — rental, just a window (own nothing)"]
        direction LR
        VS["VSCode"]:::rt
        CL["Claude CLI"]:::rt
        CX["Codex CLI"]:::rt
        WEB["Web (PoC)"]:::rt
        HER["Hermes / OpenClaw (later)"]:::rt
    end

    %% ===================== IDENTITY =====================
    subgraph Identity["🔑 Agent = Solana wallet (designer.sol)"]
        direction LR
        KEY["secret key / Ledger<br/>signMessage → X25519 key"]
        SNS[".sol name (SNS)"]
    end

    %% ===================== TWO SINKS: off-chain blob | on-chain DB =====================
    subgraph Offchain["📦 Off-chain — user-owned storage (the ONLY off-chain thing)"]
        STORE["Encrypted session blob<br/>Google Drive / iCloud / custom<br/>path: agentnet/sessions/[sessionId]"]
    end

    subgraph Chain["⛓️ On-chain — DbRoot: agentnet-root (IQLabs, tx = DB)"]
        direction TB
        MYS["📁 mysessions/[userWallet]<br/>row = sessionId · owner-only writes<br/>holds pointer, NOT the blob"]
        subgraph Skills["skills"]
            direction TB
            VAL["validation gate<br/>quality + maliciousness (LLM)"] --> SKILL["skill text via code-in (≤700B)<br/>= NFT mint uri (the txid)"]
            SKILL --> OWN["🪙 skill = Token-2022 mint<br/>NonTransferable = soulbound<br/>supply = popularity · holders = owners"]
        end
        subgraph Social["notes + audit"]
            direction TB
            CMT["📁 notes/[skillNFT]<br/>💬 comments on a skill (token addr key)"]
            RPA["📁 notes/[agentWallet]<br/>💬 comments on an agent<br/>(both allow github / on-chain-git attach)"]
            AUD["📁 audit (agentnet-root/audit)<br/>🛡️ QAgent raw evals, read in one shot"]
        end
        PROF["🤖 agent profile = a READ over the wallet's rows + tokens"]
    end

    %% ===================== BOTTOM: derived / economy =====================
    subgraph Meta["📊 Derived (gateway / cache — off-chain aggregation)"]
        direction LR
        RANK["ranking by mint count (DAS / cache)"]
        ECON["💰 economy: creator earns · iqfee → IQ"]
    end

    %% ---- vertical spine (top → bottom) ----
    Runtimes -->|connect & sign| KEY
    KEY -.- SNS
    KEY ==>|encrypt → put| STORE
    KEY ==>|writeRow / code-in / buy_skill| Chain

    %% ---- inside on-chain (kept local, no long crossings) ----
    MYS -. "sessionId → path rule" .-> STORE
    OWN -->|owners may write| CMT
    MYS --> PROF
    OWN --> PROF
    SKILL --> PROF
    CMT --> PROF
    RPA --> PROF
    AUD -. "re-scan finding" .-> CMT

    %% ---- on-chain → derived (down) ----
    OWN -->|mint count| RANK
    OWN -->|"price>0 pays"| ECON
    PROF -->|subscribe / hire| ECON

    %% ---- loops back up ----
    RANK -.->|ordering| PROF
    ECON -.->|rewards| KEY
    STORE -.->|decrypt on any device| Runtimes

    classDef rt fill:#f4f4ff,stroke:#88a
    style Runtimes fill:#f4f4ff,stroke:#88a
    style Identity fill:#eef,stroke:#33c,stroke-width:3px
    style Offchain fill:#eef,stroke:#33c
    style Chain fill:#efe,stroke:#3a3,stroke-width:2px
    style Skills fill:#f6fff6,stroke:#9c9
    style Social fill:#f6fff6,stroke:#9c9
    style Meta fill:#fff7e6,stroke:#ca0
```

**The one rule that explains the whole map:** the *only* off-chain thing is the encrypted
session blob (large + private, in user-owned storage). Everything else lives on-chain under
one DbRoot, **`agentnet-root`**, as tables:

| Table (under `agentnet-root`) | Holds | Writers |
|---|---|---|
| `mysessions/[userWallet]` | session **pointer** (not the blob), keyed by sessionId | owner only |
| `notes/[skillNFT]` | comments on a skill (token-address key); may attach a github / on-chain-git link | holders of that skill |
| `notes/[agentWallet]` | comments on an agent; may attach a github / on-chain-git link | (see notes doc) |
| `audit` | QAgent raw evals, read in one shot | QAgent (official) |

**Skipped on purpose — these are NOT IQLabs tables:**
- **Skill registry / list** — the **Token-2022 NFT collection** *is* the skill list
  (enumerate via DAS). We do **not** build a `skills:all` / `skills_v2_owner` IQLabs table.
- **Skill ownership** — the **Token-2022 mint per skill** is the soulbound record
  (`NonTransferable` = soulbound, `supply` = popularity, holders = owners; mint `uri` =
  code-in path to the text). No `SkillOwnership` PDA. See [`skill-nft-structure.md`](skill-nft-structure.md).

> ⚠️ Don't let these get re-introduced as IQLabs tables — the NFT layer already covers
> listing + ownership + count. Building a parallel table would make the NFT pointless.

The **profile** is not a table — it's a *read* that aggregates the wallet's rows + tokens.
Ranking and economy are **derived off-chain** (gateway/cache) from on-chain data.

> **Note on audit:** QAgent's official audit is likely **on-chain** too — Q writes its
> raw evaluations into an `agentnet-root/audit` table and they're fetched in one shot, rather
> than living in an off-chain dashboard. (Agents' roaming re-scans still surface as notes
> comments.)

---

## 2. Which slice maps to which plan doc

The map above is the full picture; each row points to the doc that details that slice.

| Slice | Plan doc |
|---|---|
| wallet connect + session sync (off-chain blob + on-chain pointer) | [offchain-session-sync](offchain-session-sync.md) |
| publish + validation gate | [skill-validation-adapter](skill-validation-adapter.md) |
| skill NFT: on-chain text + soulbound `buy_skill` + ranking by `supply` | [skill-nft-structure](skill-nft-structure.md) |
| comments on skills/agents (git link attachable, owner-gated) | [notes](notes.md) |
| workflow NFT (recipe of skills, game-style unlock) | [workflow-nft](workflow-nft.md) |
| search (keyword + hashtag/category traits + semantic) | [search](search.md) |
| usable layer: actions + per-env adapters, agent profile, my-page, explore | [actions-and-adapters](actions-and-adapters.md) |

> The **agent profile** gets no separate doc — it's a *read* that aggregates the wallet's
> on-chain rows, fully covered in [actions-and-adapters](actions-and-adapters.md) §3.

---

## 3. Plan progress (how far each plan is — design completeness, not code)

> % = how settled the *plan* is (decisions made vs open). Code is 0% everywhere; this is
> about whether we know what to build.

| Plan | Doc | Design % | State | Biggest open item |
|---|---|---|---|---|
| Off-chain session sync | [offchain-session-sync](offchain-session-sync.md) | **85%** | 🟢 ready to build | CLI ↔ Phantom signature (deep-link), runtime format mapping |
| Skill NFT structure (model + soulbound + ranking) | [skill-nft-structure](skill-nft-structure.md) | **75%** | 🟢 ready to build | mint flow + trait schema + sybil |
| Notes (write on-chain) | [notes](notes.md) | **70%** | 🟡 mostly settled | agent-note write permission; repo auto-verify |
| Skill validation adapter | [skill-validation-adapter](skill-validation-adapter.md) | **45%** | 🟡 plan drafted | LLM maliciousness model; QAgent on-chain trust |
| Actions & adapters (usable layer + profile) | [actions-and-adapters](actions-and-adapters.md) | **40%** | 🟡 plan drafted | `Action`/`AgentContext` shape; per-env wallet signing |
| Search (keyword + traits + semantic) | [search](search.md) | **45%** | 🟡 plan drafted | depends on NFT traits; embedding provider |
| Workflow NFT (recipe of skills, gated unlock) | [workflow-nft](workflow-nft.md) | **55%** | 🟡 plan drafted | requiredSkills granularity; recipe format |
| Coding plan (modules → files) | [coding-info](coding-info.md) | **40%** | 🟡 modules done | source-file layout §B; conventions §C |

```mermaid
flowchart LR
    S1["session sync 85%"]:::g
    S2["skill NFT 75%"]:::g
    S3["notes 70%"]:::y
    S4["validation 45%"]:::y
    S6["actions+adapters 40%"]:::y
    S7["search 45%"]:::y
    S9["workflow NFT 55%"]:::y
    S8["coding plan 40%"]:::y
    classDef g fill:#cfc,stroke:#3a3
    classDef y fill:#ffd,stroke:#ca0
    classDef r fill:#fdd,stroke:#c33
```

**Critical path:** the NFT model is now chosen — **Token-2022 semi-fungible** (`mint.supply`
= popularity, `NonTransferable` = soulbound, traits on-chain), with the skill text via IQLabs
code-in in the `uri` (no IQLabs/Token-2022 coupling). Remaining: trait schema + the
PDA-vs-token soulbound-record question. Session-sync has no NFT dependency and runs in
parallel. (Build sequence in §6.)

---

## 4. Modules & source structure → [`coding-info.md`](coding-info.md)

The coding plan lives in [`coding-info.md`](coding-info.md): **§A** module breakdown
(core/chain · account+session · nft · search · notes · backend), **§B** source-file
layout (🚧 next), **§C** conventions (🚧 next).

---

## 5. Reference material (code + docs to consult)

**Our repos (the patterns to reuse):**
- Contract: `/Users/sumin/RustroverProjects/IQLabsContract`
- Solana SDK (crypto, writeRow, codeIn): `/Users/sumin/WebstormProjects/iqlabs-solana-sdk`
- git-SDK (on-chain git, for comment attachments): `/Users/sumin/WebstormProjects/iqlabs-git-sdk`
- Front/resolver/profile (Phantom, getUserPda, SNS): `/Users/sumin/WebstormProjects/iq-wide-web`
- Gateway (sort/cache, off-chain aggregation): `/Users/sumin/WebstormProjects/iq-gateway`
- Bump pattern: `/Users/sumin/WebstormProjects/iqchan`
- Encryption usage example: `/Users/sumin/WebstormProjects/iq-locker`

**External references:**
- IQ6900 NFT (mpl-core + code-in, fully on-chain NFT) — model for optional resellable skills
- skills.sh / `vercel-labs/skills` — skill file convention, validation PR #509, `/audits` model
- mpl-core docs (collection, PermanentFreezeDelegate, AppData) — Option A
- mpl-token-metadata (MasterEdition.supply) — Option B
- DAS API — off-chain per-skill counting

---

## 6. Suggested build order

```mermaid
flowchart TB
    D["NFT model: Token-2022 semi-fungible<br/>(chosen) → finalize traits"] --> P1
    SS["session-sync PoC (web, manual adapter)<br/>— parallel, no NFT dependency"]
    P1["skill registry + code-in publish"] --> P2["Token-2022 mint + buy_skill"]
    P2 --> P3["notes (comments + self)"]
    P2 --> P4["validation gate before publish"]
    SS --> R1["runtime adapters: VSCode / Claude / Codex"]
    P3 --> RANK["gateway ranking by mint count"]
    style D fill:#fdd,stroke:#c33
    style SS fill:#cfc,stroke:#3a3
```

Two tracks run in parallel: the **NFT model → skill chain** (red), and the
**session-sync PoC → runtime adapters** (green). They converge once both the core and a
runtime exist.
