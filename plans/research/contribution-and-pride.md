# Production / Contribution Gamification + Pride When AI Does the Work

> Research brief feeding `plans/game-plan.md` (axis C + the 육성/pride thesis) and #73.
> Date 2026-06-23. The "production" axis (doing/shipping a lot feels good) — the complement
> to the collection axis in `collectible-ux.md`.

## Part 1 — Making "doing / shipping a lot" feel good

Through-line: convert *effort* into a **visible, cumulative, identity-shaped artifact** you
can look at and show off. Healthy versions reward *real output*; unhealthy ones reward
*not-missing* (streaks).

- **GitHub contribution graph** — green squares + streaks. Sticky via daily binary feedback +
  don't-break-the-chain + competence/identity signaling + loss aversion. Dark side: measures
  activity not impact (Goodhart), green-square farming, anxiety/burnout, excludes
  invisible/cross-platform/collaborative work. A natural experiment ([arXiv 2006.02371](https://arxiv.org/pdf/2006.02371))
  showed removing the streak counter cut weekend + single "keep-green" commits -> it was
  driving low-value behavior; GitHub itself walked the streak back.
  [invisible work](https://www.clairecodes.com/blog/2018-10-12-what-a-green-github-graph-doesnt-show/) ·
  [Romijn: harmful](https://github.com/isaacs/github/issues/627)
- **Strava** — auto-publishing feed + one-tap kudos + segments. Public visibility -> consistency
  (most transferable finding); kudos reframes effort as celebrated. Dark side: performing for
  the feed. [kudos study](https://www.sciencedirect.com/science/article/pii/S0378873322000909)
- **Apple Fitness rings** — closing rings (Gestalt closure = "mental itch"), daily-reset
  (healthiest streak form), celebratory animation. [psych](https://trophy.so/blog/the-psychology-of-apple-watchs-close-your-rings)
- **Duolingo** — XP/streak/leagues; loss aversion is the spine; equal XP for easy/hard trains
  grind-trivial (Goodhart); broken long streaks suppress re-engagement (people quit, not
  restart). [streak design](https://yukaichou.com/gamification-analysis/streak-design-gamification-motivation-burnout/)
- **Snapchat streaks** — pure loss aversion with no underlying value = the anti-model.
- **Wrapped / year-in-review** (Spotify/GitHub/Strava) — retrospective, cumulative,
  identity-shaped, shareable; highest delight-to-harm ratio (no daily punishment).
  [behavioral science](https://irrationallabs.com/blog/spotify-wrapped-behavioral-science/)
- **LeetCode / Stack Overflow rep** — permanent, never-resetting score; no loss-anxiety, only
  upside; tying score to *earned privileges* keeps it honest.

**Ranked for AgentNet:** 1) Ship log (outcomes) · 2) outcome-weighted contribution graph ·
3) AgentNet Wrapped (almost pure upside) · 4) cumulative never-resetting tiers · 5) kudos on
ships · 6) streaks only in Apple-rings form (daily-reset, freezes), de-emphasized ·
7) leaderboards last, cohort-only.

**Guardrails:** measure shipped *outcomes* not actions (test: "would users do this if the
counter were invisible?"); reward depth not grinding (weight by difficulty); no
catastrophic-loss streaks; honor invisible work; loss-free celebratory notifications;
gameable-resistant (tie to verified artifacts); private-by-default; retrospective > daily.

## Part 2 — Pride when an AI does the work

The tension: if the agent does the labor, what is the human proud of? The literature's answer
matches our 육성 thesis.

- **IKEA effect under automation** — we value what we labor over; removing effort removes the
  valuation. One-click "magic button" AI feels hollow; **co-creation / assembly / direction**
  preserves ownership. [IKEA-in-AI](https://imchamz.medium.com/the-ikea-effect-in-ai-why-co-creation-beats-full-automation-d6b6a1ac6b94)
- **Psychological ownership scales with input effort** — AI co-writing lowered felt ownership,
  but **longer/richer prompts and effort-gated input restored it** (output reflects your
  intent). [arXiv 2404.03108](https://arxiv.org/abs/2404.03108)
- **Authentic vs hubristic pride** (Tracy & Robins) — engineer for *authentic* (specific
  effort/accomplishment, prosocial); starve *hubristic* (raw volume vanity, "I'm #1").
  [PMC3137237](https://pmc.ncbi.nlm.nih.gov/articles/PMC3137237/)
- **Midjourney showcase** — model is a commodity; the **prompt (your decision) is revealed** and
  a curated *body of work* is celebrated -> pride for taste/direction. The gold standard of
  "AI did the pixels, I get credit for judgment."
- **AI coding mastery risk** — Anthropic RCT: AI-assisted devs scored ~17% lower on
  comprehension of what they just used; but high-mastery users used AI to *understand*
  (ask why) vs low-mastery to just *produce*. Surface decisions/trade-offs to protect felt
  competence. [Anthropic](https://www.anthropic.com/research/AI-assistance-coding-skills)
- **No-code / indie "ship" culture** — maker identity survives abstraction when the human
  composes/directs; **the ship is the unit of pride**, not keystrokes.

**Pride relocates to:** (1) outcome pride — *I shipped this*; (2) process pride — *I directed
this well* (framing, taste, iteration, rejection); and — cleanest, per our discussion —
(3) **육성 pride: I raised this agent.**

**AgentNet takeaways:** count *Ships* not activity; lead with a body-of-work portfolio not a
heatmap; surface the human's decisions ("your calls" / prompt-reveal) as first-class;
celebrate shipped things + decisions made + problems solved, weighted by difficulty;
proportional/honest credit ("I shipped this *with* my agents"); no streaks/decay; optional
"why this approach" explainers to protect mastery; showcase for taste not volume.

**The 육성 synthesis (our addition):** the single cleanest answer to "what is the human proud
of" is **the agent they raised** — it absorbs outcome + process pride into a persistent
character, makes growth the body-of-work, and (because growth is non-portable) is also the
moat. See `plans/game-plan.md`.
