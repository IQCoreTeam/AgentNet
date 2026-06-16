# Hermes skills → NFT minting → skill-detection (item 2, research/design)

> **Status: research/design only — no source-code changes proposed here.** This doc feeds
> the item-1 / [issue #33](https://github.com/IQCoreTeam/AgentNet/issues/33) build (skill
> authoring + publish). It obeys the repo rule **"study, don't vendor — no source forks."**
>
> Siblings (cite, don't duplicate):
> [`skill-ingestion-research.md`](skill-ingestion-research.md) (the OSS survey),
> [`skill-ingestion.md`](skill-ingestion.md), [`skill-nft-structure.md`](skill-nft-structure.md),
> [`search.md`](search.md).

## 0. Why this doc

We were asked to (a) check how **Hermes** uses skills, (b) connect that process to **NFT
minting**, and (c) **extract/replicate the mechanism that lets an agent detect which skills to
use in Claude Code** — plus surface useful OSS for AgentNet.

The finding up front: AgentNet's *design* for this is already strong.
[`skill-ingestion-research.md`](skill-ingestion-research.md) already documents, from primary
sources, how Claude / Hermes / Codex detect and load skills. The real gaps are **wiring**
(the marketplace MCP surface is not connected to the runtime spawn) and the **authoring /
self-improvement loop** (the issue-#33 piece). This doc captures the mechanism and the
connection design so the build is accurate; it does **not** write code.

Decisions locked with the user:
- **Skill-detection: native description-match now; a routing index designed for later (§4).**
- **Self-improvement loop: suggest-and-confirm, not autonomous (§3).**

Two source-of-truth notes:
- **`NousResearch/hermes-agent` is real** (shipped ~June 2026; SKILL.md + progressive
  disclosure) — verified live: https://github.com/NousResearch/hermes-agent ·
  docs https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/
- The **"leaked Codex" framing is a misnomer.** Codex's skill system is *public*
  ([`openai/skills`](https://github.com/openai/skills) — "Skills Catalog for Codex"), and
  AgentNet already verified Codex's native SKILL.md support by
  inspecting the shipped binary ([`skill-ingestion-research.md`](skill-ingestion-research.md)
  §3). There is nothing to "leak" — treat it as a documented, public mechanism.

---

## 1. How Hermes uses skills (study, don't vendor)

Primary sources: `NousResearch/hermes-agent` docs —
`website/docs/user-guide/features/skills.md`, `.../guides/work-with-skills.md`,
`.../developer-guide/creating-skills`. (Already summarized in
[`skill-ingestion-research.md`](skill-ingestion-research.md) §2 — this section adds only the
**self-improvement** angle relevant to minting.)

**Skill shape & discovery.** A skill is a `SKILL.md` (YAML frontmatter: required `name`,
`description`; optional `version`, `platforms`, `metadata.hermes` {tags, category, config})
plus optional supporting files. Discovered from `~/.hermes/skills/` (category subdirs) +
`skills.external_dirs`. Same `---`-block + body shape as Claude → portable
(agentskills.io standard).

**Loading = three-tier progressive disclosure** (Hermes' own mechanism, like Claude):
- **L0** `skills_list()` → `[{name, description, category}, …]` (~3k tokens) at session start.
- **L1** `skill_view(name)` → full SKILL.md body, only when the agent judges it relevant.
- **L2** `skill_view(name, file)` → a specific reference file on demand.
- "Skills don't cost tokens until they're actually used."

**Activation lanes.** Built-in skills = always-on slash commands (`/skill-name` injects the
full body alongside the task). Hub skills = on-demand, `hermes skills install
official/<cat>/<skill>`. Per-platform enable/disable.

**The self-improvement loop (the part #33-C wants studied).** Hermes does not only *consume*
skills — it **authors** them. After solving a non-trivial task it can turn the solution into a
reusable skill (via its skill-management tool), then refine that skill on later reuse. Two
things to lift from this (the *behavior*, not the code):
1. **Judgment** — *when* a solved task is worth becoming a skill. Heuristic distilled from the
   Hermes "keep skills focused" guidance: promote a task to a skill when it is (a) **reusable**
   (likely to recur), (b) **specific** (one clear job — "deploy a Python app to Fly.io," not
   "all of DevOps"), and (c) **procedural** (a repeatable method, not a one-off answer).
2. **Artifact** — a well-formed SKILL.md whose `description` states both **what** it does and
   **when** to use it (that field is the match signal — §2).

AgentNet difference: Hermes writes skills to a local dir for free; **AgentNet mints them
on-chain (costs SOL, public)**. So the loop must be **gated** (§3), not autonomous.

---

## 2. Skill-detection mechanism to replicate (Claude Code)

This is the mechanism "that lets an agent detect which skills to use." It is **native to
Claude Code** — AgentNet's job is to *feed* it, not rebuild it.

**The mechanism (progressive disclosure):**
- At session start the runtime loads **only `name` + `description`** for every skill into the
  system prompt (cheap; hundreds of skills cost almost nothing).
- When a request matches a skill's `description`, the model reads the **full `SKILL.md`** via
  the `Skill` tool / bash, into context, before doing the work.
- **The `description` (what + when) is the single primary match signal.** A vague description =
  the skill is never detected. (Confirmed against the leaked Claude harness in
  [`skill-ingestion-research.md`](skill-ingestion-research.md) §1b: the `<available_skills>`
  block is exactly name + description + SKILL.md path.)

**What AgentNet must do to "replicate" it — the wiring surface (recommendation to item-1).**
The marketplace MCP surface already exists
([`skill-market/index.ts`](../packages/core/src/skill-market/index.ts): `getAgentNetTools`,
`handleToolCall`, `createAgentMcpServer`) but [`runtime/spawn.ts`](../packages/core/src/runtime/spawn.ts)
`query({ options })` passes **none** of the five options that turn detection on. From
[`skill-ingestion-research.md`](skill-ingestion-research.md) §1:

| `query()` option | Role | Action |
|---|---|---|
| `skills: string[]` | enable installed SKILL.md by name | list bought skills + `verify`, `skill-shopping` |
| `settingSources: ['project']` | load project `.claude/skills` + CLAUDE.md | include `'project'` |
| `systemPrompt.append` | always-on directive (passive `verify`; later: authoring nudge) | append the directive |
| `mcpServers` | in-process MCP server | wire the marketplace tools (see adapter note below) |
| `allowedTools` | permit the MCP market tools | allow `search_skills` / `buy_skill` (and future `publish_skill`) |

**Adapter note:** `createAgentMcpServer` returns a low-level `@modelcontextprotocol/sdk`
`Server`. The agent-SDK `mcpServers` option wants an in-process SDK server — so item-1 should
add a `createSdkMcpServer` adapter wrapping the same `getAgentNetTools` / `handleToolCall`
(noted in [`skill-ingestion.md`](skill-ingestion.md) §6). Same tools, SDK-shaped transport.

**Design recommendation — a description-quality gate at publish.** Because `description` is
the entire detection signal, enforce "what + when" at authoring time: extend the format check
([`nft/skill.ts` `checkFormat`](../packages/core/src/nft/skill.ts)) / the authoring UI to
reject an empty or vague `description`. Cheapest, highest-leverage detection improvement.

---

## 3. Connecting the loop to NFT minting (suggest-and-confirm)

Adapt the Hermes self-improvement loop (§1) to AgentNet's on-chain economics. **Gated, not
autonomous** (mint costs SOL + is public):

1. Agent solves a reusable task → recognizes it's skill-worthy (judgment heuristic, §1).
2. Agent drafts a `SKILL.md` (name + `what+when` description + body).
3. Agent **proposes** minting it. **User confirms** before any on-chain write.
4. On confirm → a new **`publish_skill` MCP tool** calls the existing
   [`publishSkill()`](../packages/core/src/nft/skill.ts) → code-in the SKILL.md JSON +
   Token-2022 mint via the workflow-gate program (1 copy auto-minted to creator).

**`publish_skill` tool — design for item-1 to implement** (sibling of the existing
`search_skills` / `buy_skill` in [`skill-market/index.ts`](../packages/core/src/skill-market/index.ts)):

```
name: "publish_skill"
description: "Author and mint a new skill as an on-chain NFT. Use after solving a reusable,
              specific, procedural task the user wants to keep. Costs SOL and publishes
              publicly — only call after the user confirms."
inputSchema:
  name:        string  (≤64 chars, [a-z0-9-])     — required
  description: string  (≤1024 chars, what + when)  — required
  skillText:   string  (full SKILL.md body)        — required
  category:    string
  hashtags:    string[]
  price:       number  (lamports; default 0.1 SOL, free allowed)
```

**The confirm gate is free — reuse the existing approval path.** Tool calls already route
through `canUseTool` → `ApprovalChannel` in
[`spawn.ts:117`](../packages/core/src/runtime/spawn.ts). `publish_skill` (like `buy_skill`)
is an on-chain spend, so it should surface an approval card; the user's confirm *is* the gate.
No new gating mechanism needed.

**Closing the round-trip (already built — name it as the loop):** minted NFT →
`readSkillMintMetadata` ([`nft/token2022.ts`](../packages/core/src/nft/token2022.ts)) →
`SkillSync.installBought` ([`skill-market/ingest/`](../packages/core/src/skill-market/ingest/))
writes the SKILL.md back to the skills dir → next session it's **auto-detected** via §2. So:
*solve → author → confirm → mint → install → detect-and-reuse* — the AgentNet equivalent of
the Hermes loop, with on-chain ownership/reputation in place of a local file.

---

## 4. Skill-detection at scale — routing index (designed for later)

Native description-match (§2) **ships now** with zero infra. Its ceiling: the model sees every
skill's name+description each session, so it degrades once the marketplace holds many hundreds
of skills (context bloat + dilution). Hermes mitigates this with a smaller side-model ("Tool
Gateway") that pre-filters skills before the main model sees them.

**Later design (not built now):** a semantic routing layer in front of detection —
1. Embed each skill's `description` at publish/index time.
2. On a task, retrieve top-K by similarity, optionally rerank, expose **only** those K to the
   model's `skills` list.
3. Fall back to the full list when K is small.

Hook into the existing seams: the off-chain
[`indexerSource`](../packages/core/src/core/skillSource.ts) (already an HTTP indexer
abstraction) is the natural home for the embedding index, and `search.md` already floats an
embedding index for vocabulary-mismatch search — same component, two consumers (human search +
agent routing).

**Concrete reference — SkillRouter (verified, open-source).** This exact retrieve-and-rerank
design is already published and shipped: *SkillRouter: Skill Routing for LLM Agents at Scale*
(Alibaba; arxiv https://arxiv.org/abs/2603.22455 · code
https://github.com/zhengyanzhao1997/SkillRouter). A compact **1.2B** retrieve-and-rerank
pipeline hits **74.0% Hit@1** over a **~80K-skill** registry, 13× fewer params + 5.8× faster
than the strongest baseline, and **ships open 0.6B models + benchmark data.** Its load-bearing
finding for AgentNet: **hiding the skill body drops routing accuracy 31–44 points** — i.e.
description-only matching (§2) genuinely degrades at scale, so once the marketplace is large the
router should index **full skill text**, not just `name`+`description`. SkillRouter's open models
are a directly-reusable starting point for this layer.

---

## 5. Open-source ideas for AgentNet (evaluate, don't necessarily adopt)

All links verified live unless flagged.

**On-chain agent/skill identity + reputation — closest standard to AgentNet's model:**
- **ERC-8004 "Trustless Agents"** (Ethereum, Draft) — agent identity as **ERC-721 NFTs**
  (URIStorage) + on-chain **Reputation** and **Validation** registries; agents advertise
  A2A/MCP/ENS endpoints. https://eips.ethereum.org/EIPS/eip-8004 · reference impl
  [`ChaosChain/trustless-agents-erc-ri`](https://github.com/ChaosChain/trustless-agents-erc-ri).
  *Why:* this is essentially AgentNet's "mint
  skills/agents as NFTs + reputation in the wallet," already standardized on EVM — directly
  relevant to the **git-sdk EVM-port** track, and a reference for the reviews/notes layer.

**Authoring format + seed inventory (keep SKILL.md portable):**
- **[agentskills.io](https://agentskills.io)** ([repo](https://github.com/agentskills/agentskills)) —
  the open SKILL.md standard (Anthropic-originated; "Discovery → Activation → Execution"). Authoring
  AgentNet skills as plain agentskills.io SKILL.md keeps them portable across Claude/Codex/Cursor/Hermes.
- **[anthropics/skills](https://github.com/anthropics/skills)** — canonical reference skills (format ground-truth).
- **[VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills)** — curated 1000+ SKILL.md catalog; seed inventory + format examples.

**Tool routing + connectors (for the §4 routing layer):**
- **[ComposioHQ/composio](https://github.com/ComposioHQ/composio)** — 1000+ toolkits with built-in tool search/routing + auth.
- **[modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)** — de-facto MCP connector reference impls; how minted skills can expose themselves uniformly.

**Agent memory (parallels existing work):**
- **[mem0ai/mem0](https://github.com/mem0ai/mem0)** — universal cross-session memory layer; complements the existing
  `agentnet-shared-memory` design.

**Multi-agent orchestration (future workflow composition only — not near-term):**
- [LangGraph](https://github.com/langchain-ai/langgraph) / [CrewAI](https://github.com/crewAIInc/crewAI) /
  [AutoGen](https://github.com/microsoft/autogen) (now maintenance-mode, succeeded by Microsoft Agent
  Framework) — coordinate multiple minted skills into workflows; revisit when the workflow-NFT track
  ([`workflow-nft.md`](workflow-nft.md)) matures.

### 5b. Frontier bets — "out-of-world" power for AgentNet

Higher-ambition than §5. Each is mapped to the AgentNet thesis (*skills/agents are
wallet-owned NFTs; runtimes rent the agent; reputation lives on-chain*) and the superpower it
unlocks. Research/eval only — flags noted.

**A. Agents that pay each other — turn skills into a live economy.**
- **x402** (Coinbase, HTTP-402-native payments) + **AP2 / Agent Payments Protocol** (Google;
  extends A2A + MCP). https://x402.org · https://ap2-protocol.org · https://github.com/coinbase/x402
- *Unlock:* today a skill is bought once. With x402, an agent can **pay per skill-use** —
  including paying *another agent's* skill on demand (HTTP 402 → auto-pay → retry). AgentNet
  becomes a metered skill economy, not just a one-time marketplace. Skill NFT = the asset;
  x402 = the per-call meter; creator royalties flow automatically. Pairs with the existing
  6.9% fee-treasury split. *Flag:* x402 is EVM/stablecoin-first; a Solana x402 path or a
  Solana-native equivalent needs checking before committing.

**B. Skills as programmable IP with automatic royalties — the workflow-NFT dream, prebuilt.**
- **Story Protocol** — L1 for IP-as-NFT (ERC-721 + ERC-6551) with **programmable licensing**
  and a **royalty module** that auto-splits revenue parent→child. Has an **Agent TCP/IP**
  framework for agents trading IP. https://story.foundation
- *Unlock:* a **workflow** ([`workflow-nft.md`](workflow-nft.md)) is literally a *child IP* of
  its component **skills**. Story's royalty module does parent→child revenue splits **natively**
  — exactly the "workflow pays its constituent skills" economics AgentNet would otherwise hand-
  build. Strong reference (or target chain) for the **git-sdk EVM-port** track. *Flag:* EVM,
  not Solana — relevant if/when the EVM port lands; study the royalty-module design regardless.

**C. Provable skill execution — trust without trusting the runtime.**
- **Phala Network** (GPU **TEE** / confidential compute for agents) — run the agent + skill
  inside a hardware-attested enclave; prove *what ran* + keep keys private.
  https://phala.com/solutions/ai-agents
- **Lagrange DeepProve** (production **zkML** — "prove inference of ML models blazingly fast,"
  end-to-end LLM support). https://github.com/Lagrange-Labs/deep-prove
- *Unlock:* AgentNet's reputation is only as good as "did the agent really run this skill /
  really run `verify`?" A TEE attestation (or zk proof) makes skill execution **verifiable** —
  a skill NFT can carry proof it was executed as published, and on-chain reputation becomes
  un-fakeable. This is the "out-of-world" trust layer. *Flag:* zkML is still
  10,000–100,000× slower than native inference (2026) → use TEE for live runs, reserve zk for
  short settlement/policy proofs. Both are R&D-grade; design for later.

**D. Native Solana agent superpowers — most immediate, lowest risk.**
- **Solana Agent Kit** (SendAI; 60+ on-chain actions, ships an **MCP server**, 30+ protocol
  integrations). https://github.com/sendaifun/solana-agent-kit
- *Unlock:* AgentNet is already on Solana. This gives bought agents real on-chain actions
  (transfers, swaps, NFT ops) out of the box, and its MCP-server shape is the **same surface**
  AgentNet's marketplace tools plug into (§2). Lowest-friction power-up; usable now.

**E. Position AgentNet as infra beneath agent runtimes/economies.**
- **[ElizaOS](https://github.com/elizaOS/eliza)** (open framework for autonomous AI agents) and
  **Olas / Open Autonomy** ([valory-xyz/open-autonomy](https://github.com/valory-xyz/open-autonomy),
  the Autonolas autonomous-services framework).
- *Unlock:* the README thesis is "AgentNet sits beneath competing runtimes like MCP." Eliza and
  Olas are exactly those runtimes (siblings to Hermes/OpenClaw) — each a place that can *rent* a
  wallet-owned AgentNet agent and fetch the same on-chain skill pool. Treat them as **integration
  targets**, not dependencies. (Virtuals Protocol is a fourth such ecosystem — left out here only
  because I haven't verified a canonical repo link.)

### 5c. Crazy agentic frontier — AgentNet as an on-chain evolutionary skill library

The biggest idea: **AgentNet's skill-NFT marketplace is the missing substrate that self-
improving-agent research already needs.** Those projects all generate/refine reusable skills
but store them in a local folder. AgentNet makes the skill library **on-chain, owned, shared,
and monetized.** Mapped to the self-improvement loop in §3:

**A. Voyager — the skill-library pattern (this IS AgentNet's thesis, proven in research).**
- Voyager (NVIDIA/Caltech): an LLM agent that grows an **ever-growing skill library of
  executable code**, retrieves + composes skills, self-verifies, and compounds ability over
  time. https://arxiv.org/abs/2305.16291 · https://voyager.minedojo.org
- *Unlock:* Voyager's local skill library = AgentNet's marketplace, but **shared across wallets
  and runtimes**. The §3 loop (solve → author → mint → install → reuse) is literally Voyager's
  curriculum + skill library + self-verification, with on-chain ownership and a price. Cite this
  as the academic backbone of the whole AgentNet skills thesis.

**B. Darwin Gödel Machine — evolutionary skill lineages on-chain.**
- DGM (Sakana AI, ICLR 2026): a self-improving agent that **rewrites its own code**, kept as an
  **expanding lineage** of variants under population-based evolution (SWE-bench 20%→50%). Open
  impl: https://github.com/lemoz/darwin-godel-machine · paper https://arxiv.org/abs/2505.22954
- *Unlock (the crazy one):* every minted skill already has a **parent** (it was forked/improved
  from a bought skill). Record that parentage on-chain → the marketplace becomes a **fossil
  record of evolving skills**: fork a bought skill, mutate it, mint v2 as a *child* of v1.
  **`mint.supply` / reputation = the fitness signal** that selects which lineages propagate.
  AgentNet turns DGM's in-memory lineage into a public, owned, economically-selected evolution.
  *Flag:* self-modifying agents need the §5b-C sandbox/attestation story for safety.

**C. GEPA + ACE — auto-refine a skill before re-minting it.**
- GEPA (ICLR 2026 Oral): gradient-free **reflective prompt evolution** — reads execution traces,
  reflects in natural language, mutates the prompt; beats RL (GRPO) by ~20% with 35× fewer
  rollouts. https://github.com/gepa-ai/gepa · ACE evolves a structured "Playbook" context.
- *Unlock:* this is the **"refine on reuse"** half of the Hermes loop (§1), made concrete. After
  a skill underperforms, GEPA/ACE rewrite its `SKILL.md` body/description from real traces → mint
  an improved **v2 NFT** (feeds B's lineage, and the §2 description-quality goal). Skills don't
  just get bought — they get **measurably better** each generation.

**D. Letta / MemGPT — memory-first self-improving agent harness.**
- Letta Code (https://github.com/letta-ai/letta-code): tiered OS-style memory (Core/Recall/
  Archival), agents **rewrite their own context + acquire skills from experience**, identity
  persists across models.
- *Unlock:* directly complements the existing **`agentnet-shared-memory`** track — the memory
  layer that decides *when* a solved task is skill-worthy (§1 judgment) and feeds the mint
  trigger. Letta's "skill learning from experience" is the engine behind AgentNet's authoring
  loop.

**The combined "out-of-world" vision:** a Voyager-style agent generates skills → GEPA/ACE refine
them from traces → DGM-style forking mints each generation as a child NFT → `supply`/reputation
acts as evolutionary fitness → the best skill lineages propagate across every wallet and runtime.
**A self-improving agent economy whose evolution is recorded, owned, and selected on-chain** —
no other skill-library project has the ownership + economic-selection layer AgentNet already has.
*Flag:* all of §5c is research-grade; the near-term concrete step is still §3 (suggest-and-confirm
mint) — these define the trajectory, not v1.

---

## 6. Hand-off

- This doc is research/design; **no code changes here.**
- Concrete build items it hands to item-1 / #33: (a) the five-option spawn wiring + the
  `createSdkMcpServer` adapter (§2), (b) the `publish_skill` MCP tool over existing
  `publishSkill()` with the suggest-and-confirm gate on the existing `canUseTool` path (§3),
  (c) a description-quality check at publish (§2).
- Designed-for-later: the semantic routing index (§4).

**Link-verification status (every external claim is linked + checked):** all GitHub repos,
docs sites, the ERC-8004 EIP, and the Voyager / DGM / **SkillRouter** arxiv papers in
§§0,4,5,5b,5c were fetched live and confirmed to exist (June 2026). The SkillRouter paper
(arxiv 2603.22455, Alibaba) is now **verified** — promoted from flagged to paper-backed in §4.
One item remains intentionally unlinked: **Virtuals Protocol** (§5b-E), named without a link
because no canonical repo was verified. Post-cutoff star/date figures are descriptive only, not
load-bearing.
