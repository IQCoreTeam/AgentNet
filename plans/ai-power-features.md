# AgentNet — AI-side power features (the capability engine)

> **Status: research/design / strategy — no source-code changes here.** Companion to
> [`hermes-skill-minting.md`](hermes-skill-minting.md) (which covers the skill→mint→detect
> mechanism). That doc is the *plumbing*; this doc is the **AI capability** that makes AgentNet
> extreme-powerful and shareable — independent of the web3/economy layer.
> Every external link below was fetched live and confirmed (June 2026).

## 0. Thesis — collective self-improvement (the one idea)

Hermes and OpenClaw go viral as **personal self-improving agents** ("the agent that grows with
you") — but each agent improves **alone**, locked to one runtime. AgentNet has one structural
advantage no single-runtime agent can copy: a **shared, on-chain skill pool**. So:

> **One agent's discovery instantly upgrades everyone's agent.** Capability compounds across
> *all* users, not per-user — an AI **network effect on intelligence itself.**

That is the out-of-world AI angle and the viral moment to chase:
*"my agent learned a skill another user's agent invented an hour ago — and got better at my task
without me teaching it."* Collective + self-improving + visible.

Everything below is a concrete AI capability that builds toward that. All map onto the
self-improvement loop in [`hermes-skill-minting.md`](hermes-skill-minting.md) §3
(*solve → author → refine → publish → install → detect-and-reuse*) — these turn that loop from
**manual** into a real **engine**.

---

## 1. Self-writing skills — auto-authoring (build first)

The agent writes and *refines its own* `SKILL.md` from what it just did, instead of a human
authoring every skill.

- **GEPA** — gradient-free **reflective prompt evolution**: reads execution traces (reasoning,
  tool calls, outputs), reflects in natural language to diagnose errors, mutates the
  instruction. Beats RL (GRPO) by ~20% with **35× fewer rollouts**.
  Repo: https://github.com/gepa-ai/gepa · paper (ICLR 2026 Oral) https://arxiv.org/abs/2507.19457
- **ACE — Agentic Context Engineering**: maintains a structured, itemized **"Playbook"** and
  applies incremental delta updates — accumulates many granular reusable insights over long
  horizons. Paper: https://arxiv.org/abs/2510.04618
- **AgentNet fit:** after a solved task, GEPA drafts the SKILL.md body; ACE keeps the agent's
  evolving playbook. Feeds the §2 *description-quality* goal (auto-write a strong "what+when"
  description) and the §3 mint step (a ready, refined artifact to publish).
- **Why it matters:** removes the human-authoring bottleneck — the loop can run continuously.

## 2. Compounding skill library — Voyager pattern

Capability that **accumulates and composes** instead of resetting each session.

- **Voyager** (NVIDIA/Caltech/Stanford) — an LLM agent with an **ever-growing skill library of
  executable code**: stores, retrieves, and **composes** skills into new behaviors
  (skill A + B → new skill C), with self-verification and no catastrophic forgetting. Skills are
  "temporally extended, interpretable, and compositional."
  https://arxiv.org/abs/2305.16291 · https://voyager.minedojo.org
- **AgentNet fit:** AgentNet *is* Voyager's skill library — but **shared across wallets and
  runtimes** instead of one local folder. Composition is the multiplier: bought + authored
  skills combine into emergent abilities (ties to the workflow-NFT track,
  [`workflow-nft.md`](workflow-nft.md)).
- **Why it matters:** this is the literal academic backbone of "the agent gets better over
  time," already proven.

## 3. Self-driven curriculum — open-ended growth

The agent decides **what to learn next** from its own capability gaps — no prompting.

- Voyager's third component (alongside the skill library): an **automatic curriculum that
  maximizes exploration**, proposing the next task/skill suited to the agent's current state.
- **AgentNet fit:** the agent inspects its owned skills + recent failures → identifies a gap →
  *searches the marketplace* (existing `search_skills`) or *authors* the missing skill (§1).
  "Knows what it doesn't know." Drives the §3 loop autonomously (still gated at the mint step).
- **Why it matters:** turns the agent from reactive into **self-extending** — the behavior that
  makes "grows with you" feel alive.

## 4. Skill routing at scale — keep detection sharp

As the shared library grows to thousands+, native name+description matching degrades. Routing
keeps the right skill findable.

- **SkillRouter** (Alibaba) — 1.2B **retrieve-and-rerank** pipeline, **74% Hit@1 over ~80K
  skills**, 13× fewer params + 5.8× faster than the strongest baseline; **ships open 0.6B
  models + benchmark.** Key finding: **hiding the skill body drops accuracy 31–44 pts** — at
  scale the router must index **full skill text**, not just name+description.
  https://github.com/zhengyanzhao1997/SkillRouter · https://arxiv.org/abs/2603.22455
- **AgentNet fit:** exactly the §4 routing-index design in
  [`hermes-skill-minting.md`](hermes-skill-minting.md), already built + open. Lives in the
  off-chain indexer seam ([`indexerSource`](../packages/core/src/core/skillSource.ts)).
- **Why it matters:** the hive library is worthless if the agent can't find the right skill.

## 5. Self-evolving agent core — DGM

Beyond new *skills* — the agent improves its own *harness*.

- **Darwin Gödel Machine** (Sakana AI, ICLR 2026) — a self-improving agent that **rewrites its
  own code**, kept as an expanding **lineage** under population-based evolution. SWE-bench
  **20% → 50%**, Polyglot 14% → 31%. Open impl:
  https://github.com/lemoz/darwin-godel-machine · paper https://arxiv.org/abs/2505.22954
- **AgentNet fit:** each improvement is a forked artifact with a **parent** — the natural
  lineage structure for versioned skills (v1 → v2). Population selection = "which variant wins."
  *Flag:* self-modifying code needs a sandbox/verification story (see §7); design for later.
- **Why it matters:** the ceiling-raiser — improves the agent itself, not just its toolkit.

## 6. Memory → real personalization (the "grows with you" hook)

The capability users *feel*. Hermes' virality is largely this.

- **Letta / MemGPT** — tiered OS-style memory (Core / Recall / Archival); agents **rewrite their
  own context** + acquire skills from experience; identity persists across models.
  https://github.com/letta-ai/letta-code
- **mem0** — universal cross-session memory layer (user / session / agent state).
  https://github.com/mem0ai/mem0
- **AgentNet fit:** complements the existing **shared-memory** track; the memory layer is also
  the **judge** for §1/§3 — it decides *when* a solved task is reusable enough to become a skill.
- **Why it matters:** personalization is the retention + word-of-mouth engine.

## 7. Self-verification — reliability as a feature

- The passive **`verify`** skill (already designed in
  [`skill-ingestion.md`](skill-ingestion.md)) — always-on, the agent checks its own work / vets
  a candidate skill before acting. Pairs with Voyager's self-verification (§2).
- **Why it matters:** a self-improving agent that ships bad skills loses trust fast.
  Verification is what makes autonomous authoring safe enough to leave on.

---

## 8. How it fits together (the engine)

```
        ┌─ §3 self-driven curriculum: find a capability gap
        │
   gap ─┤─ have skill? ── §4 SkillRouter: find + load the right skill ──┐
        │                                                                │
        └─ missing? ── §1 GEPA/ACE: author + refine a new SKILL.md ──────┤
                                                                         │
   §2 Voyager: compose owned skills into new ability ────────────────────┤
                                                                         ▼
   §7 verify: self-check ──► (gated) mint as NFT ──► installs to disk ──► shared pool
                                                                         │
   §6 memory: judge reusability, personalize ◄───────────────────────────┘
   §5 DGM: periodically improve the agent core itself
```

Net effect: a continuously self-improving agent whose every gain enters a **shared** library —
collective intelligence (§0).

## 9. Build order (AI side)

1. **§1 self-authoring (GEPA)** — turns the manual mint loop into an engine. Highest leverage.
2. **§2 / §3 compounding library + curriculum (Voyager)** — makes "gets better over time" real.
3. **§6 memory** — the felt personalization / retention hook.
4. **§4 SkillRouter** — once the shared pool is large.
5. **§5 DGM** + **§7 verify-gated autonomy** — research-grade; need the §hermes-doc-5b-C
   sandbox/attestation safety story before turning self-modification loose.

## 10. Cross-model fusion — Codex × Claude (a moat only AgentNet has)

Inspired by **OpenRouter Fusion** (launched 2026-06-13): fan a prompt across 3–5 models in
parallel, a **judge model** synthesizes one output + surfaces consensus / contradictions /
coverage gaps / blind spots; claims near-Fable-5 quality at ~half cost.
Docs: https://openrouter.ai/docs/guides/features/plugins/fusion · model
https://openrouter.ai/openrouter/fusion

**Why AgentNet specifically:** [`runtime/spawn.ts`](../packages/core/src/runtime/spawn.ts)
already drives **both** Claude (`@anthropic-ai/claude-agent-sdk`) and Codex
(`@openai/codex-sdk`) behind ONE uniform `Engine` interface. No other runtime drives Claude
*and* Codex uniformly — so cross-vendor fusion is a structural moat, not just a feature.

**Flavor 1 — completion-level fusion (easy, ship first).** For *reasoning/planning* sub-steps
(not file edits), fan out to Claude + Codex (+ others), judge-synthesize. Options: call
OpenRouter Fusion directly as the planning model, or reuse the existing **llm-council** pattern
(panel → anonymous peer-review → synthesized verdict). Low risk, immediate quality + a viral
line ("planning fused across Claude + Codex"). Plugs in at the prompt/plan layer, leaves the
agentic execution single-engine.

**Flavor 2 — agent-level fusion (hard, novel, the flagship).** Run **both full agentic CLIs on
the same task in parallel**, each in an isolated worktree, then a **judge** picks/merges:
- Claude-agent + Codex-agent each produce a **diff** → judge model (or a `verify`-style skill,
  §7) scores both → keep the best, or synthesize a merged diff.
- = "best-of-N agents with a judge," cross-**model** not just cross-sample. A per-vendor
  population, conceptually a 2-wide [DGM](https://github.com/lemoz/darwin-godel-machine) (§5).
- Maps cleanly onto the uniform `Engine` interface: a `fusionEngine` wraps two `spawnCli`
  handles, runs turns in parallel, emits judge-selected `ChatMessage`s. Worktree isolation
  (per the existing worktree primitives) keeps their edits from colliding.

**Honest risks (flavor 2):**
- Two agents editing files **diverge** — merging *diffs* is much harder than merging text
  answers. Cleanest when the deliverable is a single artifact/diff, not a long multi-file
  session.
- **Cost 2×+** (parallelism cuts latency, not spend).
- **Judge is the ceiling** — a weak judge yields output worse than the best single agent.

**Recommendation:** ship Flavor 1 now (cheap quality + marketing); treat Flavor 2 as the
flagship R&D bet — "two frontier agents compete, best wins" is both a killer demo and a genuine
moat, but gate it on a solid judge + diff-merge story.

## 11. Verification status

Every external reference was fetched live and confirmed (June 2026): repos
[gepa-ai/gepa](https://github.com/gepa-ai/gepa),
[lemoz/darwin-godel-machine](https://github.com/lemoz/darwin-godel-machine),
[zhengyanzhao1997/SkillRouter](https://github.com/zhengyanzhao1997/SkillRouter),
[letta-ai/letta-code](https://github.com/letta-ai/letta-code),
[mem0ai/mem0](https://github.com/mem0ai/mem0); papers Voyager (2305.16291), DGM (2505.22954),
SkillRouter (2603.22455), GEPA (2507.19457 — "GEPA: Reflective Prompt Evolution Can Outperform
Reinforcement Learning", ICLR 2026 Oral), ACE (2510.04618 — "Agentic Context Engineering",
ICLR 2026). All five paper IDs were fetched live and resolve to the exact titles. **OpenRouter
Fusion** (§10) was also verified live — launched 2026-06-13, fan-to-N + judge-synthesis
(https://openrouter.ai/docs/guides/features/plugins/fusion). Nothing here is an unsourced or
unverified claim.
