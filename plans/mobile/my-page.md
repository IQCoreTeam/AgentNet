# Agent "My Page" — Mobile Design Plan

Status: draft for build. Mobile-first. The vscode profile panel will be polished later
(Section 8), reusing the same `AgentProfile` data and section intent.

This plan is deliberately "boring on purpose": every pixel on the page maps to a real data
source (Section 2). Anything without a backing source is either an **action entry** (do the
real thing) or an **honest deferred state**, never a fabricated number. Reputation is earned
external work, not a self-minted points token (verified-work-indexer.md §1).

References: `plans/screen-rearrangement.md §9.2`, `plans/confirmed-screen-flow.md §4.3`,
`plans/verified-work-indexer.md`, `plans/design-system.md`.

---

## 1. Principles

1. **Real data only.** No mocked counters. If a metric has no source today, it does not
   appear as a number. (User constraint: "없는 기능 목업만 만들진 않겠지.")
2. **Reputation = verified external work**, not a fungible points token. GitHub stars become
   a reputation signal only once the indexer actually serves them (Phase 2). Until then we
   ship the *action* (register work), not a fake star count.
3. **Terminal that celebrates you** (design-system.md §2): quiet baseline, earned celebration
   on real milestones only (skill acquired, first verified repo).
4. **Hard rules** (design-system.md §1): tokens `--an-*` only, no raw hex; no emoji (SVG
   icons); no em/en-dash in copy; type from the scale; 8pt grid; 48dp min touch target;
   dark-first.

---

## 2. Data inventory (UI element -> source -> status)

Source of truth: `AgentProfile` in `packages/core/src/chat/marketMessages.ts:34-45`,
`Reputation` in `packages/core/src/core/types.ts:74-80`, built by
`packages/core/src/skill-market/ingest/env.ts:394-459` (`getAgentProfile`).

| UI element | Field / source | Status |
| --- | --- | --- |
| Avatar (프사) | wallet-derived deterministic SVG, `packages/core/src/chat/ui/avatar.ts` | REAL (util exists; mobile just doesn't render it yet) |
| Wallet + "you" badge | `AgentProfile.wallet`, `AgentProfile.self` | REAL |
| Created count | `reputation.skillsPublished` / `createdSkills.length` | REAL |
| Owned count | `ownedSkills.length` | REAL |
| Holders / "fame" | `reputation.totalSupply` (sum of on-chain supply) | REAL |
| My Skills grid | `createdSkills: SkillCard[]` (name/image/price) | REAL |
| Owned skills | `ownedSkills: SkillCard[]` | REAL |
| Blog (self notes) | `notes.filter(isSelfNote)` (text, optional gitLink, date) | REAL |
| Comments | `notes.filter(!isSelfNote)` (author, text, optional gitLink) | REAL |
| Comment gate | `AgentProfile.canComment` (holds >=1 of this agent's skills) | REAL |
| Register GitHub work | existing flow: `ConnectGithub.tsx` + `RegisterWorkRepo.tsx` -> `registerWorkRepo` -> `core/verifiedWork.ts` (marker + indexer work-link) | REAL (built; only exposed in Settings drawer today) |
| Verified repos list + ★ stars | indexer ALREADY serves it: `GET /work-links?wallet=<wallet>` returns the wallet's repos with cached `stars`/`forks` (12h refresh, marker-verified on write). See Appendix A. Gap is only app-side: `getAgentProfile` doesn't fetch it and `AgentProfile` has no `verifiedRepos` field yet | DATA REAL (indexer) -> needs app wiring (Phase 1.5) |
| Wallet reputation number (sum of repo stars) | not aggregated server-side (only creator supply-ranking exists), but trivially computable by summing the verified repos' `stars` | DERIVABLE -> client-side sum now, or a small indexer endpoint later |
| Trophies / level / hot-skills / signature badges | none (deferred "after open", soulbound) | ABSENT -> Phase 3 |

Bottom line: identity, stats, skills, blog, comments, and the GitHub-registration *action*
build now with zero backend. The verified repos + ★ stars **data already exists in the
indexer** (read path + star caching done); surfacing it needs only a small app wiring of
`getAgentProfile` (Phase 1.5), not new indexer work. Only server-side reputation
aggregation / hot-skills / trophies remain genuinely unbuilt.

---

## 3. Information architecture (single-column layer-cake)

Order follows a "who -> proof -> possessions -> voice" narrative, matching the confirmed
flow (confirmed-screen-flow.md §4.3) plus the game-profile "hero + plaques" pattern
(Game UI Database, Toptal game-UI guide).

```
HERO            identity: avatar frame, wallet, you badge, copy
STAT PLAQUES    Created / Owned / Holders  (real counts, plaque style)
VERIFIED WORK   Phase 1: [Register GitHub work] action card
                Phase 2: registered repos + ★ stars as reputation
MY SKILLS       2-col grid of createdSkills  ("스킬보기")
BLOG            self-note carousel (self only to compose)
COMMENTS        stacked list + gated compose
(other agents)  "Buy all N skills" footer when !self
```

Rationale: the hero answers "whose page is this", plaques give at-a-glance status, Verified
Work is the reputation surface (the page's reason to exist long-term), then the agent's
*possessions* (skills) and *voice* (blog/comments).

---

## 4. Component specs

Each section lists: data binding, states, interactions, visual notes (tokens/sizes).

### 4.1 Identity Hero
- Data: `wallet`, `self`, avatar util(wallet).
- Visual: avatar 56-64dp in a subtle framed plaque (`--an-bg-1`, hairline `--an-line`,
  radius lg=16). Wallet shortened `AAAA…ZZZZ` (mono, `--an-fg-dim`). "you" pill when `self`
  (green-dim + green-line). A copy-wallet icon button (24dp, ghost).
- States: skeleton (already have `AgentProfileSkeleton`); offline -> avatar + wallet still
  render (both derivable without network).

### 4.2 Stat Plaques
- Data: Created=`skillsPublished`, Owned=`ownedSkills.length`, Holders=`totalSupply`.
- Visual: 3 equal plaques in a row; big number (title 20sp/600), label below (caption
  12sp, `--an-fg-mute`). `--an-bg-1` card, radius md=12. No icons needed; keep terminal-calm.
- Note: "Holders" labels `totalSupply` (the documented fame metric). If the label reads
  oddly, use "Supply". Decide in review.

### 4.3 Verified Work (the reputation surface)
- **Phase 1 (now):** an action card, not numbers. Title "Verified work", one line
  "Link a GitHub repo to your skills to prove your work." + primary button
  "Register GitHub work" that opens the existing `ConnectGithub` (if no token) then
  `RegisterWorkRepo` flow. Reuse the components verbatim; also keep them in Settings.
  - If a registration just succeeded (`state.workRepoResult.ok`), show a small confirmed
    line ("Linked N skills to owner/repo") — real, from existing state.
- **Phase 1.5 (small app wiring, NO new indexer):** the indexer already returns the data
  (`GET /work-links?wallet=`, Appendix A). Add `verifiedRepos` to `AgentProfile` and have
  core `getAgentProfile` fetch it, then render the registered repos list here: repo
  `owner/name`, cached ★ stars, linked skills, link out to GitHub. Roll the summed stars
  into a single reputation figure shown in the hero/plaques (client-side sum is fine).
- **Phase 2 (optional new backend):** a dedicated per-wallet / per-skill reputation
  endpoint (server-side star aggregation, weekly hot-skills, signature skill). Only needed
  if we want server-authoritative scoring or ranking beyond a client-side sum.
- States: self sees the register action + own repos; others see the public verified repos
  (read-only). Offline -> action disabled with an offline hint; repos show last-known if
  cached, else a calm offline line.

### 4.4 My Skills grid
- Data: `createdSkills`. 2-col grid, 1:1 tiles, 16dp gutter (design-system §5). Reuse
  `SkillCardTile`. Tap -> `getSkillDetail` (skeleton already wired in MarketScreen).
- Empty (self): "You haven't published any skills yet" + link to Publish.

### 4.5 Blog
- Data: `notes.filter(isSelfNote)`. Horizontal carousel of self-notes (text, date, optional
  gitLink chip). Compose box visible only when `self` ("Post to blog").
- Empty: quiet "No posts yet."

### 4.6 Comments + compose
- Data: `notes.filter(!isSelfNote)`. Vertical stack: author(shortened) + text + date.
- Compose: gated by `canComment` (must hold >=1 of this agent's skills). When !canComment
  and !self, show the box disabled with "Hold a skill to comment."

### 4.7 Buy-all (other agents only)
- When `!self && createdSkills.length > 0`: sticky footer "Buy all N skills". Existing logic.

---

## 5. State matrix

| Condition | Behaviour |
| --- | --- |
| Loading | `AgentProfileSkeleton` (already built) |
| self == true | show compose (blog), Verified-work register action, no Buy-all |
| self == false | hide register action + blog compose; show Buy-all; comments gated by canComment |
| offline | hero (avatar+wallet) still renders; network sections show calm offline hint, not spinners (mirror the Recents offline pattern) |
| empty section | quiet one-line empty copy, never a fake zero-state metric |

---

## 6. Visual + motion binding (design-system.md)

- Surfaces: page `--an-bg-0`; cards/plaques/hero `--an-bg-1`; hairlines `--an-line`.
- Text: `--an-fg` / `--an-fg-dim` / `--an-fg-mute`. Accent `--an-green` (sparingly; this is
  "my page" so a touch more than Chat, per §2 "my possessions shine").
- Radius: md 12 (plaques), lg 16 (hero/cards), full (pills/badges).
- Type: heading 24 (screen), title 20 (stat number/section header), body 16, caption 12.
- Motion: baseline 100-300ms. Celebration (400ms+, particles/glow, haptic) ONLY on real
  milestones: skill acquired/equipped, first verified repo crossing a threshold (Phase 2).
- No emoji anywhere (SVG icons); no em/en-dash in copy.

---

## 7. Phased build

**Phase 1 — now, UI only, zero backend (this is what we build first):**
- Files touched: `surfaces/webview/src/market/AgentProfileView.tsx` (restyle into the hero
  layer-cake) and the avatar util import. Reuse `RegisterWorkRepo` / `ConnectGithub`.
- Deliver: avatar hero, stat plaques, Verified-work *action card* (surface existing GitHub
  registration on the Agent page), skills grid + blog + comments restyle.
- Constraint: do NOT touch `state/store.tsx`, protocol/types, or the indexer (a parallel
  session is editing skill-sync + store). Keep Phase 1 inside the view + shared util.

**Phase 1.5 — small app wiring, NO new indexer (stars as reputation, the cheap win):**
- The indexer read path + star caching are ALREADY built (Appendix A). So this is app-side
  only:
  - Core: extend `AgentProfile` with `verifiedRepos: { repo, owner, name, url, skillMints,
    stars, forks }[]`; in `getAgentProfile` (skill-market env) call
    `GET ${indexer}/work-links?wallet=<wallet>` and attach the result. Optionally add
    `repoStars = sum(stars)` to `reputation`.
  - UI: fill §4.3 with the repos list + ★ stars and show the summed stars in hero/plaques.
- Coordinate: this touches `marketMessages.ts` (type) + skill-market env + AgentProfileView;
  the parallel session is in store/skill-sync, so sequence after them or take only the
  AgentProfile type + env fetch.

**Phase 2 — optional new backend (only if needed):**
- Server-authoritative reputation: a `GET /work-links/:wallet/reputation` (or extend the
  wallet response) that aggregates stars; weekly hot-skills; signature-skill / master-crown.
  Client-side sum covers the basic case, so this is a later optimization.

**Phase 3 — post-open (deferred per docs):**
- Soulbound trophies (Pioneer at a star threshold), weekly hot skills, signature/master
  badges, leaderboard from `listAgents` (Reputation[]). Leveling only if it maps to real
  verified work, never to busy-counts.

---

## 8. vscode (later)

The vscode profile panel is polished after mobile lands. It reads the same `AgentProfile`,
so the section intent (hero, plaques, verified work, skills, blog, comments) carries over;
the avatar util is shared. We keep one data contract so mobile and vscode never diverge in
what "my page" means — only the layout adapts to the surface.

---

## 9. Open decisions

1. Reputation formula once stars exist (sum of stars? star+fork weighted? per-skill best
   repo?). Pick in Phase 2.
2. "Holders" vs "Supply" label for `totalSupply`.
3. Avatar style: confirm what `chat/ui/avatar.ts` outputs (identicon vs blocky) and whether
   it reads well at 56-64dp in a frame.
4. Does GitHub registration live on the Agent page only, or Agent page + Settings (lean:
   both; Agent page is discovery, Settings is the durable home).

---

## Appendix A. Indexer verified-work API (actual current state, audited)

Repo: `/Users/sumin/WebstormProjects/agentnet-nft-indexer`. This is what EXISTS today (so we
don't re-investigate). Base URL: `https://nft-index.iqlabs.dev` (`core/seed.ts` `getIndexerUrl()`).

Routes:
- `POST /work-links` (`src/routes/workLinks.ts:19`) — register. Fetches the repo's
  `.agentnet` marker via `raw.githubusercontent.com/{owner}/{name}/HEAD/.agentnet`
  (`github.ts:43`), verifies `marker.wallet == request.wallet` (rejects 403/422 otherwise),
  then `GET api.github.com/repos/{owner}/{name}` for id + stars/forks and upserts the row.
- `GET /work-links?wallet=<wallet>` (`workLinks.ts:68`) — the wallet's repos, newest-first.
- `GET /work-links?skill=<mint>` (`workLinks.ts:73`) — top repos for a skill, stars DESC.
- `GET /items/:mint/repos` (`items.ts:68`) — repos attached to a skill NFT.
- `GET /items/creators/ranking` (`items.ts:61`) — creators by `sum(supply)` (NOT star-based).

Table `work_link` (`src/store/db.ts:89-103`): `skill_mint, github_repo_id, repo_owner,
repo_name, repo_url, wallet, stars, forks, stats_updated_at, created_at`; PK
`(skill_mint, github_repo_id)`; indices on `(skill_mint, stars DESC)`, `(wallet)`,
`(github_repo_id)`.

Star caching: written on registration; refreshed by a stats job every 12h
(`src/stats/index.ts`, `STATS_INTERVAL_MS`, `config.ts:74`), deduped per distinct repo,
never zeroed on error.

Built: write ✅, read-by-wallet ✅, read-by-skill ✅, star/fork cache ✅, `.agentnet`
verification ✅. NOT built: per-wallet star aggregation/score, hot-skills, trophies, and
the app-side wiring that pulls `?wallet=` into `AgentProfile`.
