# AgentNet — Game / Collection Layer Plan

> Living design doc. Confirmed elements, the element board we design one-by-one,
> cross-cutting guardrails, open forks, and references.
> Started 2026-06-23. Grounded in the research under `plans/research/`.

## North Star

You don't *use* a tool — you **raise (육성) your own agent**. Every session, task,
skill, and shipped result makes YOUR agent stronger, smarter, and more *yours*.

This solves two things at once:
1. **Pride when the AI does the work.** You're not proud of keystrokes — you're proud of
   the agent you raised (Tamagotchi / RPG main / pet). = authentic pride + self-extension
   + IKEA-effect-under-automation.
2. **The moat.** Growth is **non-portable**. Use a competitor -> your agent doesn't grow.
   Use AgentNet -> session-sharing memory + skills + level compound. Switching cost = your
   raised agent. Vibe-coders consolidate here; the longer they stay, the deeper the moat
   (compounding advantage, like a leveled character / fine-tuned model).

Three engagement axes hang off the agent: **Collection** (acquire skills),
**Production** (use it / ship), **Reputation** (verifiable public track record).

## Layer split (load-bearing principle)
- **Soulbound (non-transferable) = the moat:** agent memory/personalization, level, learned
  context. Lost if you leave; cannot be bought.
- **Tradeable = the economy:** skills, cosmetics. Bought/sold on the market.
- Rule: *the moat lives in the non-transferable layer.* A maxed agent must not be sellable
  (no pay-to-win); core growth is earned only by use.

## Confirmed elements

### E1 — Verified Work Proof  ✅ (confirmed 2026-06-23)
Reputation = "how well does this agent use its skills?" anchored to **external,
costly-to-fake** signals, not self-minted numbers (on-chain OR cache are both fakeable).

- **Signal:** GitHub repos the agent built *with its skills* + external validation
  (stars, and **forks / dependents / real usage** — harder to fake than stars).
- **Provenance (no push):** verified **at blog-post time** — when the user posts a repo to
  their agent blog, we check (a) **ownership** via the existing GitHub OAuth link, and
  (b) **authorship** via AgentNet's own session logs (we already know what the agent did).
  No agent-config push into the user's repo.
- **Automation:** ship -> auto-post to the agent blog (#73) with a live stars/forks badge.
- **Record:** on-chain stores only **oracle-signed, verified milestones** (immutable notary);
  live counts stay off-chain. On-chain = notary of *verified* claims, never raw self-report —
  that is the fix for "anyone can fabricate on-chain."
- **Why it matters:** ties Collection (skills) x Production (usage) x Reputation x moat into
  one honest metric.
- **Honest limits / open:** stars are gameable too -> multi-signal (forks/usage) + provenance;
  private repos (attest ownership/authorship without exposing content?); signal weighting.
  Implementation deferred.

## Element board (design one-by-one)

### A. Agent = your "main" (육성 core / spine)
- A1 Agent as a persistent character — has a level and an evolving look
- A2 Level / XP — earned from real *shipped outcomes*, weighted by difficulty (not activity)
- A3 **Memory / personalization** — session-sharing -> learns your repos/style  ★ soulbound moat core
- A4 Visual evolution — appearance changes as it grows
- A5 Per-skill mastery — usage -> skill levels up + frame upgrade

### B. Collection (수집)
- B1 Skills as collectible cards — rarity tiers, foil/holo/glow visual language
- B2 Skill-Dex — silhouettes for un-owned + set-completion bars
- B3 Serial / editions — mint number, founder editions (per-copy scarcity)
- B4 Duplicate sinks — dupe -> cosmetic flair OR C0-C6 mastery
- B5 Rarity earned by performance — bestseller = Legendary (NOT scarcity-of-supply)

### C. Production / pride (생산)
- C1 "Ship" log — count shipped *things*, not activity
- C2 Contribution graph — weighted by outcome (no green-square farming)
- C3 "Your calls" — surface the human's decisions/direction -> legitimizes pride
- C4 AgentNet Wrapped — the agent's growth year-in-review, shareable
- C5 Forgiving cadence — no toxic streaks

### D. Social / economy
- D1 Marketplace (exists) · D2 Near-peer leaderboards · D3 Blog/feed (#73) · D4 Kudos on ships · D5 Skill gifting

## Cross-cutting guardrails (G)
- G1 Outcome > activity; weight by difficulty (anti-Goodhart)
- G2 No decay/death; growth only accrues (no anxiety streaks)
- G3 Soulbound (memory/level) vs tradeable (skills/cosmetics) split
- G4 Honest signals only (no fake scarcity/timers); multi-signal anti-farm
- G5 Proportional credit -> authentic pride, not hubristic vanity

## Open forks (resolve as we design)
1. One "main" agent vs a roster/team.  (Lean: one main + skill kit.)
2. Provenance strength: OAuth-ownership + session-log authorship (chosen) — enough for v1?
3. What "growth" concretely is: vanity level vs real capability (memory/personalization). (Lean: real.)
4. External-signal weighting: stars < forks/dependents/usage.
5. Private repos in E1.

## References
- `plans/research/collectible-ux.md` — collection psychology, game/live-ops mechanics,
  product teardowns (TCG Pocket, Genshin, Magic Eden/OpenSea/Tensor, Steam, Duolingo,
  Discord, Pokemon GO, NBA Top Shot/Sorare).
- `plans/research/contribution-and-pride.md` — production/contribution gamification
  (GitHub graph, Strava, Apple rings, Duolingo, Wrapped) + pride-when-AI-does-the-work
  (IKEA-under-automation, psychological ownership, authentic vs hubristic pride,
  Midjourney/no-code/indie-ship models).
- Issues: [#72](https://github.com/IQCoreTeam/AgentNet/issues/72) (collectible My Skills),
  [#73](https://github.com/IQCoreTeam/AgentNet/issues/73) (agent profile redesign).
