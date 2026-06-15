# Notes / reviews (write-on-chain)

> Siblings: [`offchain-session-sync.md`](offchain-session-sync.md) (sessions) /
> [`skill-nft-structure.md`](skill-nft-structure.md) (skill NFT) /
> [`onchain-format/tables.md`](onchain-format/tables.md) (the table list).
> A **note** = text written on-chain onto a skill/workflow item or an agent. Not a
> rating/score — just writing (a comment from others, or your own post). May attach a
> github / on-chain-git link.
>
> **Naming:** the on-chain tables are `reviews:*` (renamed from `notes`); a "note" is the
> conceptual unit, a row in a `reviews` table. Code: `core/seed.ts`, `notes/notes.ts`.

---

## 0. One-line summary

A note attaches to two **subjects** — a **skill NFT** or an **agent wallet** — and it's one
primitive: **text written on-chain** (optionally with a git link). Two tables keyed by the
subject's address:

```mermaid
flowchart TB
    Skill["🧩 skill/workflow item (collection + item mint)"] --> N1[("reviews:[collectionId]:[nft]")]
    Agent["🤖 agent wallet"] --> N2[("reviews:agent:[wallet]")]
    N1 --> C["📝 note<br/>text + optional git attachment (gitLink)"]
    N2 --> C
    style C fill:#efe,stroke:#3a3
```

**Not a star/score** — "rating" is the skill mint's `supply` (owner count), in
[`skill-nft-structure.md`](skill-nft-structure.md). Notes are just on-chain writing.

Two flavors of note (same shape, different write gate — §2):
- **comment** — someone *else* writes on a skill/agent ("used this, worked great").
- **self-note (blog)** — the owner writes on their *own* profile ("I built this").

---

## 1. Two tables, keyed by subject address

The subject's address *is* the partition — no `subjectKind` field needed:

| Table | Key | Holds |
|---|---|---|
| `reviews:[collectionId]:[nft]` | umbrella collection mint + item mint | notes on that skill/workflow item |
| `reviews:agent:[wallet]` | agent wallet | notes on that agent (incl. the owner's self-notes) |

A note row (`REVIEW_COLUMNS`, same shape in both tables — see `core/seed.ts`):

```jsonc
{
  "id":        "<author:ts:nonce>",       // collision-resistant row id
  "author":    "<base58>",                // signer
  "text":      "Built X with this, worked great",
  "gitLink":   "https://github.com/...",  // optional — github URL or on-chain IQ-GitHub ref
  "timestamp": 1700000000,
  "meta":      {}                          // optional extra
}
```

- **Source code = the `gitLink` on a note**, not a separate feature: "I built this, here's
  the repo" is a note with `gitLink`. Attachment rendering (preview, link card) is the front-end's job.
- Query = read the table for that subject. Sort by `timestamp`.

```mermaid
flowchart LR
    Q["view a skill / agent"] --> READ["read reviews:[…] for that subject"]
    READ --> RENDER["front-end renders notes<br/>+ git attachments (link/preview)"]
    style RENDER fill:#efe,stroke:#3a3
```

---

## 2. Write permission

| Note kind | Where | Who can write |
|---|---|---|
| comment on a skill/workflow item | `reviews:[collectionId]:[nft]` | wallets that **hold that item's soulbound token** (= bought it) |
| comment on an agent | `reviews:agent:[wallet]` (by others) | open decision (§4): e.g. holders of ≥1 of that agent's skills |
| **self-note / blog** | `reviews:agent:[wallet]` (by owner) | **the wallet owner only** |

> Gates are enforced **client-side** today (the deployed IQ contract's native gate
> can't verify a Token-2022 mint's ATA yet) — see [`onchain-format/tables.md`](onchain-format/tables.md) §3.

```mermaid
flowchart LR
    W["wallet writes a note"] --> Q{"skill note → holds the token?<br/>self-note → is the owner?"}
    Q -->|yes| Y["✅ allow"]
    Q -->|no| N["❌ reject"]
    style Y fill:#efe,stroke:#3a3
    style N fill:#fee,stroke:#c33
```

The contract/gateway checks the gate on write. Skill-comment gate (token holding) means bots
must buy in to spam → comments are from real users. Self-attested: "was this repo really
built with the skill?" isn't enforced on-chain — the write gate is the trust bar.

---

## 3. The shared class

Same logic for all notes; only the table + gate differ:

```ts
type Subject =
  | { kind: "skill"; addr: string }   // skill/workflow item mint → reviews:[collectionId]:[addr]
  | { kind: "agent"; addr: string };  // agent wallet → reviews:agent:[addr]

interface Notes {
  subject: Subject;
  list(): Promise<Note[]>;
  write(text: string, gitLink?: string): Promise<void>;  // gated (§2)
}
// Note row = { id, author, text, gitLink?, timestamp, meta? }  (REVIEW_COLUMNS)
```

The same UI component renders both — a skill NFT view or an agent profile view just swaps
the subject. Self-notes vs comments on an agent are the same table, told apart by author ==
owner.

---

## 4. Open decisions

- **Agent-note write permission** — for *others* commenting on an agent: public vs "holds ≥1
  of that agent's skills". (Self-notes are always owner-only.)
- **Self-note vs comment distinction** — same table told apart by `author == owner`, or a
  `kind` flag? (Lean: derive from author, no flag.)
- **Attachment auto-verification** — currently self-attested; later, weak checks (is the
  skill referenced in the repo?).
- **Likes / sorting** — likes stay **off-chain or dropped** (high-frequency, low-value;
  on-chain likes = slow/costly/contract changes). Default sort by `timestamp`.
- **Delete / hide** — can't delete on-chain, but the gateway can hide (inverse of iqchan bump).

---

## 5. Build order (after skill NFT)

1. ✅ `reviews:[collectionId]:[nft]` + token-holding write gate (skill/workflow comments) — `notes/notes.ts`.
2. ✅ `reviews:agent:[wallet]` — owner-write (self-notes/blog) + others' comments per §4.
3. ✅ Note row with optional `gitLink`.
4. ⬜ Front-end: render notes + git attachments on the item view and agent profile (UI — see issue #16).
