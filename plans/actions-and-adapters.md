# AgentNet Actions & Adapters

> Sibling: [`00-overview.md`](00-overview.md). This doc defines the **usable layer** —
> what a user can *do*, as environment-agnostic **actions**, plus how each environment
> (VSCode / app / Claude / web) renders them via an **adapter**.

---

## 0. The core idea

We don't build *screens*. We build **actions** — units of "a thing you can do" (data +
behavior). Each environment renders the same actions its own way:

```mermaid
flowchart TB
    subgraph Core["AgentNet Actions — shared core (write once)"]
        direction LR
        A1["connect / init"]
        A2["session sync"]
        A3["skill publish / buy"]
        A4["profile / my-page"]
        A5["explore / market"]
    end
    Core --> AD1["VSCode adapter<br/>(panels)"]
    Core --> AD2["Mobile app adapter<br/>(screens)"]
    Core --> AD3["Claude / Codex adapter<br/>(text + tools)"]
    Core --> AD4["Web adapter<br/>(pages)"]
    style Core fill:#eef,stroke:#33c,stroke-width:2px
```

- An **action** = environment-agnostic logic: it talks to the wallet, storage, and chain,
  and returns data + emits state. It does **not** know what a button or panel is.
- An **adapter** = the thin per-environment binding: it triggers actions and renders their
  result the native way (a VSCode panel, an app screen, a Claude tool/text, a web page).
- "A section is not a screen — it's the set of things I can use." → actions are those things.

---

## 1. The action catalog

Grouped by intent. Each action names the **plan doc** it builds on.

### A. Connect & setup

| Action | What it does | Builds on |
|---|---|---|
| `connectWallet` | connect a Solana wallet in this environment (Phantom in browser; deep-link/callback in CLI) | [offchain-session-sync](offchain-session-sync.md) §5–6 |
| `init` | **runs on first connect when nothing is set up**: pick a session-storage OAuth, log in, create the `mysessions` table | [offchain-session-sync](offchain-session-sync.md) §5.1 |
| `linkDevice` | connect this device separately (phone, PC) — same wallet, each device authorizes its own storage/session access | [offchain-session-sync](offchain-session-sync.md) §5.2 |
| `setupLocalGit` | create the fixed local folder (per device — mobile/PC) used to `pull` repos linked in comments | notes attachments + IQ GitHub |

### B. My page (my own stuff)

| Action | What it does | Builds on |
|---|---|---|
| `myProfile` | the agent profile = this wallet (skills owned + written, notes, followers) | profile (this doc §3) |
| `myBoughtSkills` | skills this agent purchased (soulbound tokens it holds) | [skill-nft-structure](skill-nft-structure.md) |
| `myWrittenSkills` | skills this agent authored | [skill-nft-structure](skill-nft-structure.md) |
| `writeSkill` | author a new skill; **on publish, also mint one to yourself** (author gets their own copy) | [skill-nft-structure](skill-nft-structure.md) · [skill-validation-adapter](skill-validation-adapter.md) |
| `myNotes` | comments received on me / my skills | [notes](notes.md) |
| `myEarnings` | money earned from skills, aggregated | [skill-nft-structure](skill-nft-structure.md) §4 (payment) |
| `connectGitHub` | attach a GitHub (or on-chain IQ GitHub) repo link to a comment | notes attachments |

### C. Explore (others' stuff)

| Action | What it does | Builds on |
|---|---|---|
| `browseSkills` | browse skills split by **NFT trait = category**, then buy | [skill-nft-structure](skill-nft-structure.md) (trait/category) |
| `buySkill` | `buy_skill` = star = pay = equip (one tx) | [skill-nft-structure](skill-nft-structure.md) §4 |
| `listAgents` | the agent list — agents that own ≥1 skill, sorted by collections-created (see §4, the hard one) | §4 |
| `viewAgent` | another agent's public profile | profile (§3) |

> **Note on `writeSkill` self-mint:** when you author a skill, you also mint one copy to your
> own wallet — so your authored skills appear in your owned list too, and your authorship is
> proven by holding your own piece. (Open: whether the self-mint is free / always price-0.)

---

## 2. Action shape (sketch)

Every action is the same shape, so adapters bind them uniformly:

```ts
interface Action<Input, Result> {
  id: string;                                  // "buySkill", "myProfile", …
  run(input: Input, ctx: AgentContext): Promise<Result>;  // wallet + chain + storage
  // returns plain data; the adapter renders it. No UI here.
}

interface AgentContext {
  wallet: WalletSigner;        // signMessage / signTransaction (env supplies how)
  storage: StorageAdapter;     // user-chosen session storage (offchain-session-sync §3)
  chain: ChainClient;          // iqlabs-solana-sdk wrappers (writeRow, codeIn, buy_skill…)
  cache: CacheLayer;           // read-side index/aggregation (see §4) — abstract
}
```

- The **environment supplies the `AgentContext`** (how to sign, which storage, etc.).
- The **action is pure logic** over that context → returns data.
- The **adapter** renders the data + wires user intent back into `run()`.

---

## 3. Agent profile (the aggregator)

The profile isn't its own data store — it's an **aggregation** of stuff already on-chain
under the wallet:

```mermaid
flowchart TB
    W["wallet (designer.sol)"]
    W --> S1["owned skills (soulbound tokens held)"]
    W --> S2["written skills (authored + self-minted)"]
    W --> S3["comments + git attachments (notes)"]
    W --> S4["notes (comments received)"]
    W --> S5["followers"]
    W --> S6["earnings (from buy_skill payments)"]
    W -.->|"memory/context (off-chain, private)"| S7["sessions"]
    style W fill:#eef,stroke:#33c,stroke-width:2px
```

This is why "profile" had no separate plan doc — it's a **read** over the other plans.
The actions `myProfile` / `viewAgent` just gather these and hand them to the adapter.

---

## 4. The hard part — the agent list (`listAgents`)

> The question: where do we get "all agents that own ≥1 skill," sorted by "most collections
> created"? It's not a single on-chain query.

**Abstract it as a `CacheLayer`.** Don't pin it to one backend:

- The `CacheLayer` is a **read-side index** that answers "which wallets hold known skill
  NFTs" and ranks them. **It may be the gateway, or a separate backend** — we don't decide
  now.
- Ideally it **fetches the list of wallets holding known NFTs from on-chain** (e.g. the
  gateway scanning the skills collection), but **that depends on the NFT structure**, which
  depends on the Token-2022 mint/group structure ([skill-nft-structure](skill-nft-structure.md)).
- So: **build the agent structure first**, then the NFT structure, *then* wire `listAgents`
  to a concrete cache/index. Until then `listAgents` is an interface with a stub.

```mermaid
flowchart LR
    LA["listAgents action"] --> CL{{"CacheLayer (abstract)<br/>gateway OR other backend"}}
    CL -.->|"later, after NFT structure"| ON["on-chain: wallets holding known skill NFTs"]
    CL --> RANK["rank by collections created"]
    style CL fill:#fff7e6,stroke:#ca0
```

**Dependency order:** agent structure ✅ done → **then** NFT structure → **then** concrete
`listAgents` indexing/ranking. Don't build the indexer before the NFT structure exists.

---

## 5. Per-environment adapters

Same actions, different binding. The two hard env-specific bits are always **(a) how to
get a wallet signature** and **(b) how to render**.

| Env | Wallet signature | Render | Notes |
|---|---|---|---|
| Web (PoC) | wallet-adapter (Phantom) | pages | fastest to prove the core |
| VSCode ext | deep-link / callback to browser wallet | panels / tree views | "connect" menu → init flow if first time |
| Claude / Codex CLI | localhost callback + browser deep-link | text + tool calls | actions surface as tools |
| Mobile app | in-app wallet / Ledger | screens | per-device link + local git folder |

The **first-connect flow** is identical everywhere (just rendered differently):

```mermaid
flowchart LR
    C["connectWallet"] --> Q{"already set up?"}
    Q -->|no| I["init: pick storage OAuth → log in → create mysessions"]
    Q -->|yes| H["home / profile"]
    I --> H
    style I fill:#cfc,stroke:#3a3
```

---

## 5b. CLI runtime adapter — the "shared session" experience

The headline experience: **use Codex, switch to Claude, move to another device — the
session continues.** We achieve it by wrapping the existing CLIs (proven pattern: Cline,
Clauditor, claude-code-webstorm all spawn the CLI as a subprocess).

### How the CLIs work (verified)
Both store sessions as **JSONL, append-only** (one line = one message):
- **Claude Code:** `~/.claude/projects/{pathHash}/{session}.jsonl`; resume reads it back.
- **Codex CLI:** `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (relocatable via `CODEX_HOME`).
- Claude Code also emits `--output-format stream-json` → structured live stream (easier capture than tailing the file).

### Two key choices this unlocks
- **No API key needed** — we spawn the user's already-logged-in CLI as a subprocess, so it
  runs on **their subscription**. (BYOK / our-own-chat is a separate, later path for users
  with no CLI.)
- **JSONL append-only** → sync only the *new lines* since last sync, not the whole file.

### The flow

```mermaid
flowchart TB
    DRIVE[("drive: canonical session<br/>(encrypted, CLI-neutral)")]
    subgraph WRAP["our CLI runtime adapter"]
        IN["① inject: drive → convert → write the CLI's jsonl → resume"]
        RUN["② CLI runs on the user's subscription (subprocess)"]
        CAP["③ capture: watch jsonl appends (or stream-json)<br/>→ convert new lines → canonical"]
        SYNC["④ encrypt → overwrite drive (every N lines / on idle/exit)"]
    end
    DRIVE --> IN --> RUN --> CAP --> SYNC --> DRIVE
    style DRIVE fill:#efe,stroke:#3a3,stroke-width:2px
```

1. **Inject** — pull the canonical session from drive, convert to the target CLI's JSONL,
   write it where that CLI reads (`~/.claude/...` or `CODEX_HOME`), then `resume`.
2. **Run** — the CLI talks to the model on the user's own login/subscription.
3. **Capture** — watch the JSONL for appended lines (or read `stream-json`); convert the new
   lines to our canonical format.
4. **Sync** — encrypt and overwrite the drive blob **every N new lines / on idle / on exit**
   (cheap; drive write only — **on-chain `mysessions` write is once per new session**, not per sync).

### Canonical session format = the magic
The drive holds **one CLI-neutral session** (JSONL is nearly identical across both, so the
canonical format ≈ a normalized message list). Each CLI gets a thin **converter adapter**:

```
canonical (on drive) ⇄ Claude jsonl   (claude adapter)
canonical (on drive) ⇄ Codex jsonl    (codex adapter)
```

- **Codex → Claude continuity:** open the same canonical session through the Claude adapter.
- **Cross-device:** new device → connect wallet → pull canonical from drive → inject into
  whatever CLI is there. Same conversation, anywhere.
- We only build: the **canonical format** + **one converter per CLI** (Claude, Codex). The
  wrapper/spawn machinery is shared.

### Two paths (our role is the same: lend the agent's "outfit", collect the log)
- **Path 1 — our wrapper (now):** the user types in a Codex/Claude chat we wrap; we capture
  the jsonl → save locally → sync to drive. We drive it. ✅ (above)
- **Path 2 — they wear our outfit (later):** OpenClaw/Hermes **fetch our skills**
  (designer / marketer …), pick + act on their own, and call a **function we expose that
  saves their log locally in the same format** → then the same Path-1 sync picks it up. We
  don't control them; we just lend the identity+skills and collect the log.

We are **not building autonomous agents** — we put an on-chain "outfit" (identity + skills +
session) on whatever does the work (a human in a CLI, or an autonomous agent). The sync
mechanism is identical; only *who is driving* differs. **Path 2 is later** — it needs the
runtime to call our log-save function, so it ships after Path 1.

> This realizes [`offchain-session-sync.md`](offchain-session-sync.md) §6's "plug into each
> runtime" — that doc owns the session/encryption model; the CLI wrapping + JSONL converters
> live here. Source location: [`coding-info.md`](coding-info.md) §B `runtime/`.

### 5b.1 Reference repos — these already wrap codex/claude (study before building)

The subprocess-wrap pattern is proven; we reuse it and add wallet identity + drive sync.

| Repo / product | What it shows us |
|---|---|
| [opencode-claude-code-plugin](https://github.com/unixfox/opencode-claude-code-plugin) | spawns `claude` as subprocess with `--output-format stream-json`; wraps it as a model backend — **closest to our spawn.ts + capture.ts** |
| [claude-code-webstorm](https://github.com/Iceman253/claude-code-webstorm) | chat-UI frontend over claude CLI subprocess, stream-json output — a surface example |
| [claude-code-plus](https://github.com/touwaeriol/claude-code-plus) | wraps **Claude + Codex + Gemini** CLIs in one GUI — multi-CLI wrapper (our convert/claude + convert/codex) |
| [Clauditor](https://plugins.jetbrains.com/plugin/30981-clauditor) | session browse/search/resume/fork over claude jsonl — closest to our session management (but local-only; we add chain + drive) |
| [RunVSAgent (Codex-JetBrains)](https://github.com/Haleclipse/Codex-JetBrains) | runs VSCode agents inside JetBrains via an Extension-Host bridge — the "host a runtime" pattern |

```mermaid
flowchart LR
    REF["reference wrappers<br/>(opencode-plugin · webstorm · claude-code-plus)"] -->|"same pattern"| RT["our runtime/<br/>spawn · capture · inject · convert"]
    RT -->|"+ we add"| OURS["wallet = agent · encrypted drive sync · cross-device"]
    style RT fill:#cfc,stroke:#3a3
    style OURS fill:#efe,stroke:#3a3
```

**Our differentiator vs all of them:** they wrap the CLI *locally* (pretty UI, session resume
on one machine). We add **wallet identity + encrypted session on the user's drive + on-chain
pointer** → the same session follows you across CLIs and devices, owned by the wallet.

---

## 6. Build order (within this layer)

1. ⬜ Define the `Action` + `AgentContext` shape (§2) — the contract adapters bind to.
2. ⬜ Implement connect/init/session actions (group A) — reuse session-sync core.
3. ⬜ Web adapter first (PoC), proving actions render in one env.
4. ⬜ My-page actions (group B) once skill soulbound exists.
5. ⬜ Explore actions (group C); `buySkill` after soulbound, `browseSkills` after NFT traits.
6. ⬜ `listAgents` last — **after** agent structure + NFT structure (§4).
7. ⬜ VSCode / Claude / Codex / mobile adapters on top of the proven web core.

## 7. Open decisions

- **Action granularity** — are `myBoughtSkills` / `myWrittenSkills` separate actions or one
  `mySkills(filter)`? (Lean: one with a filter, per zo's "no meaningless wrappers".)
- **Self-mint on `writeSkill`** — always free (price-0) for the author? Always one copy?
- **Local git folder** — fixed path convention per platform (mobile vs PC); pull-only or sync?
- **`AgentContext` wallet abstraction** — one `WalletSigner` interface covering Phantom /
  Ledger / deep-link callback across all envs.
- **Canonical session format** — how close to raw JSONL? (both CLIs are ~the same message
  list, so likely a thin normalization, not a heavy schema.)
- **Capture method** — watch the JSONL file for appends vs read `stream-json`; sync trigger
  (every N lines vs on idle/exit).
- **CLI must be installed/logged-in** — subprocess path assumes the user has codex/claude
  CLI; for users without one, fall back to BYOK chat (separate, later).
- **CacheLayer interface** — minimal read methods now (so `listAgents` compiles), concrete
  backend later (§4).
