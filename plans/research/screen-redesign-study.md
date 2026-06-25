# Screen Redesign Study — Profile / Skills / Buy / Comments

Companion to [`collectible-ux.md`](./collectible-ux.md) and issue
[#77](https://github.com/IQCoreTeam/AgentNet/issues/77).

`collectible-ux.md` was the **science** (why collection desire works). This doc is the
**field study** of four real-app families — Tumblr/creator-commerce, Duolingo, Steam/PlayStation,
and open-source SNS (Bluesky + Mastodon, read from source) — turned into concrete, copyable
layout decisions for the four screens we are unhappy with:

1. **Agent profile** (mine = proud / others = enviable)
2. **Skill list** (My Skills + browse)
3. **Skill-buying** (skill/workflow detail)
4. **Comments** (holder-gated reviews)

This is a **study, not a build plan.** No code yet. The goal is a shared mental model and a
backlog of decisions (see §7) before we touch the screens.

Our real components today, for reference when we build:
`webview/src/AgentProfileView.tsx`, `MarketScreen.tsx` (SkillCardTile), `SkillDetailView.tsx`,
comments composer inside `AgentProfileView`. Stats already wired: Created / Owned / Copies,
verified repos + live stars, workflows (gold). Avatar = wallet-seeded character.

---

## 0. The unifying design language (distilled from all four sources)

Five principles that every one of the four screens should obey. These are the through-line.

1. **Dark neutral chrome + ONE saturated accent.** Steam's page is navy `#1b2838`; the *only*
   bright things are the capsule art, the green buy button, and the review label — so the eye
   goes art → buy → social-proof with zero competition. Our "bland green dock" fails precisely
   because the *whole surface* is green, leaving nothing to pop. **Demote the background,
   promote one buy color.** (We already have `--an-*` tokens + accent green / forge violet / workflow gold.)

2. **The number is bigger than its label.** Duolingo sets the numeral huge and bold, the word
   tiny beneath. You read "247" before "day streak," which reframes a metric as a trophy. Every
   stat we show (Copies, Stars, Created) should follow this.

3. **Show, don't tell — art leads.** On both Steam and Gumroad the cover/media is the single
   largest pixel area and the first argument, made before any text is read. Our skill/workflow
   art should lead the card and dominate the detail screen.

4. **Make scarcity & ownership visible as a number/color.** "X% own this," "only N minted,"
   rarity color bands (CS2), owned-items greyed in a bundle. Honest live numbers beat labels
   because they can't be faked. We have a native one: **`copies`**.

5. **One card shell, two modes (read vs buy).** Patreon/Gumroad interleave post-cards and
   product-cards in one feed, blending "follow/read" with "buy." Our blog posts, skills, and
   workflows should share a card shell, differing only by the buy affordance.

---

## 1. AGENT PROFILE — "Tumblr blog × Duolingo trophy shelf × Steam showcase"

### What real apps do
- **Tumblr/Patreon two-band header:** wide header image (16:9) behind a small overlapping
  avatar, then title, then a 1–2 line bio. Reads as "a person/character's *place*," not a row.
- **Patreon 2025 lesson — land on a curated "Home," not the raw feed.** Visitors see reorderable
  "shelves" (Featured / Recent / Collections / Shop) with a separate **Posts** tab one tap away.
  Raw chronological feeds bury the best work.
- **Duolingo profile = vertical trophy shelf:** avatar (biggest) → name + @handle → join date
  (muted) → **hero stats row** (each metric = huge numeral + its own colored glyph + tiny label)
  → **achievement/tier grid** → friends. All-time *records* surfaced so you're never "back to zero."
- **Bluesky/Mastodon header (from source):** avatar top-left (Mastodon 80px), action button
  top-right reserving avatar width (`paddingLeft: 90`), large bold display name with badge
  inline, handle beneath, then a **single inline stat row** (bold count + muted label, same size,
  count first) — not stacked cards. Compact "ShortNumber" counts (1.2K). Optional tabs
  (Activity / Media / Featured).
- **Steam showcase:** the *ability* to show off is itself earned (a showcase slot per ~10 levels);
  modules like "Favorite Game," "Rarest Achievement" (auto-surfaces your statistically rarest unlock
  with global %).

### Our elements → composition (top to bottom)
```
[HERO BAND]   wallet-seeded avatar (big) over a subtle character header strip
              agent name (bold, large) + verified badge inline
              short wallet @handle (muted, mono) + "you" pill
              "active since <date>" (small, muted)               ← Duolingo join-date
[STAT ROW]    Created · Owned · Copies · ⭐Stars                  ← number bigger than label
              Copies = loudest numeral (our "total XP"/fame)      ← Duolingo XP glorification
              ⭐Stars gets a gem/trophy glyph                      ← maps to verified work
[TIER STRIP]  star-count tier emblem + "★180/250 to Gold" arc     ← Duolingo badge ladder
[HOME shelves] (curated, not raw):                                ← Patreon Home tab
              · Verified Work (GitHub repos as trophies w/ stars)
              · Signature Skills (top by copies)  ← Steam "favorite" showcase
              · (optional) Rarest skill owned + its scarcity %
[TABS]        Home · Posts(blog) · Skills · Comments              ← Patreon Posts tab / Mastodon tabs
```

### Concrete decisions baked in
- Avatar is the **largest** element; identity before numbers.
- **Copies is the hero number** (loss-averse, glorified like a Duolingo streak — a glow/halo once
  a skill crosses 100 copies, echoing the "perfect-streak" halo).
- Stars drive a **tiered emblem ladder** (Bronze 10★ → Silver 50★ → Gold 250★ → iridescent
  "Legendary"), with an **always-visible progress arc** ("★180/250 to Gold") — goal-gradient.
- Profile **lands on a curated Home**, blog feed is a tab, so an agent with few posts never looks empty.
- Self vs other: self sees compose/edit affordances; other sees follow/buy and the showcase as a flex.

---

## 2. SKILL LIST — "Gumroad grid × Steam rarity bands"

### What real apps do
- **Gumroad/Ko-fi product grid:** cover-dominant cards. Cover on top, then name, then **price**,
  then **★avg + (N)**. **Price is always on the card.** Optional **"X sold"** is the strongest
  conversion element — but a *low* count ("3 sold") *hurts*, so small counts are styled down/hidden.
- **Steam/CS2 rarity color band:** a fixed, learnable color ladder (grey → blue → purple → pink →
  red → gold) where rarity falls off a cliff per tier. The **color IS the value signal** — a grid
  is appraisable in <1s by "how much red/gold is here."
- **One card shell, two modes:** product cards and post cards interleave in the same feed.

### Our elements → card anatomy
```
[COVER]   skill art, dominant (16:9-ish), with a RARITY TINT/FRAME derived from `copies`
          (fewer minted = rarer = hotter band)                    ← CS2 rarity ladder
[NAME]    skill name
[META]    price (SOL)  ·  "N copies" as the "X sold" social proof  ← Gumroad "X sold"
          (hide/de-emphasize when copies is tiny so it never reads "nobody wanted this")
[VARIANT] workflow cards = GOLD frame + composite glyph + "N skills" ← already shipped; = "platinum"
```
- My Skills uses a `[Created | Owned]` segment over the same grid (OpenSea Collected/Created).
- Same card shell hosts blog-post cards in the profile feed (read+buy blend).

### Concrete decisions baked in
- Add a **rarity tint** keyed to `copies` so the grid is scannable by prestige at a glance.
- **`copies` is our "X sold."** Show it on every skill card; suppress when low.
- Workflows remain the **gold capstone** tier visually distinct from skills (done).

---

## 3. SKILL-BUYING (detail) — "Gumroad product page × Steam item/bundle page"

### What real apps do
- **Gumroad high-converting order:** (1) full uncropped **cover** → (2) large **title/benefit** →
  (3) **price** adjacent to → (4) **buy CTA high on page** ("I want this!"), then the pitch flows
  beneath; on mobile a **sticky bottom buy bar** keeps it always reachable → (5) benefit-driven
  description (headings/bullets/media) → (6) **ratings/reviews, buyer-only.**
- **Steam:** dark neutral chrome, the buy button is the only saturated thing; Steam **repeats a
  buy box at every decision point** rather than one sticky element (resolves multi-SKU ambiguity).
- **Steam "Complete the Set" bundle (→ our workflows):** every contained item as a row with its
  own cover + price; **owned items greyed/struck + checked**; headline price is **dynamic** = sum
  of only what you *don't* own × bundle discount, CTA reads **"Complete the Set — buy remaining N
  for $X."** Loss-aversion: the *gap* is made salient.
- **Scarcity flexes:** "only N minted," "X% of players own this," PlayStation tier (Bronze→Platinum,
  Platinum = "own everything" capstone) + rarity label (Common→Ultra Rare).

### Our elements → composition (skill)
```
[HERO]    uncropped skill art on dark chrome (kills the "all-green dock")
[TITLE]   name + rarity/scarcity line ("only N minted · X% of agents own this")
[BUY]     price (SOL) + ONE saturated buy CTA, high on page
          → forge-gold buy moment (already shipped) fires on success
[DESC]    the AI-written blog-style description (headings, media)
[REPEAT]  compact price+buy box again at the bottom of the scroll  ← Steam repeated CTA
[REVIEWS] holder-gated comments block (see §4) = Gumroad buyer-only reviews
mobile:   sticky bottom buy bar so CTA is always a thumb away
```

### Our elements → composition (workflow = "Complete the Set")
```
[HERO]    gold workflow framing
[CHECKLIST] each required sub-skill as a row: cover · name · price
            owned → check + greyed/struck;  unowned → full-color    ← Steam bundle owned-state
[BUY]     "Complete this workflow — mint the remaining N skills for X SOL"
            computed live from the connected wallet                  ← dynamic bundle price
            (we already ship "Collect all N · X SOL" + per-skill owned checks — extend it)
```

### Concrete decisions baked in
- Lead with **art on dark chrome**, single accent buy color, **repeated buy box**, sticky mobile bar.
- Print **scarcity as a number** ("only N minted," "X% own").
- Workflow detail = Steam Complete-the-Set with greyed owned sub-skills + dynamic remaining price.
- Make **workflow the "Platinum"** capstone framing (own the full set).

---

## 4. COMMENTS — "Tumblr conversation-first notes × Bluesky tree thread × Steam reviews"

### What real apps do
- **Tumblr notes — conversation-first:** at low volume, a simple chronological list; at higher
  volume, **only substantive comments/captioned reblogs show by default**, plain likes collapse
  into a "+12 others" summary. Substance bubbles up, noise is buried. **Hard lesson from the 2026
  backlash: keep a thread visually CONNECTED — do NOT shatter replies into disconnected cards.**
- **Bluesky thread (from source `ThreadItemTreePost.tsx` + `const.ts`):** top-level at **42px**
  avatar, **nested replies at 24px**, a **2px muted vertical connector line**, indent
  ≈ `TREE_INDENT(16) + avatar/2` ≈ **28px per level**. Reply affordance = a `rounded_full` pill
  ("Write your reply") with a 24px avatar (`ThreadComposePrompt`). **Bluesky already ships
  permission-gated variants** (`ThreadItemPostNoUnauthenticated.tsx`) — direct precedent for
  rendering a *different composer by viewer permission* (our holder gate).
- **Steam review structure:** aggregate **verdict label gated on volume** ("Overwhelmingly
  Positive" needs 500+; you can't earn the top label without volume) + colored sentiment bar +
  Recent vs All split. Each review card: **recommend thumb pill → avatar + name + (products owned /
  reviews written) → "X hrs on record" proof-of-use → body → date → helpful-vote** that re-sorts.

### Our elements → composition
```
[AGGREGATE]  verdict label + count + sentiment bar — GATED on volume         ← Steam (don't glow with 3 reviews)
[THREAD]     top-level holder reviews at 42px avatar
             nested replies at 24px, 2px muted connector, ~28px/level indent ← Bluesky tree (connected!)
             each review card:
               · recommend pill (optional)                                   ← Steam thumb
               · avatar + short wallet + "owns N skills"                     ← Steam reviewer credibility
               · usage stat: "equipped X times / used in N runs"             ← Steam "hrs on record" analog
               · body · timestamp · helpful-vote (re-sorts top)              ← Steam helpful sort
[COMPOSER]   holder  → rounded_full "Write your review" pill (24px avatar)   ← Bluesky ThreadComposePrompt
             non-holder → LOCKED pill: "Holders can leave the first review"  ← gate as status, not barrier
             self    → no composer on own skill
[EMPTY]      "Holders can leave the first review" — frame the gate as exclusive, not empty
```

### Concrete decisions baked in
- **Conversation-first + connected thread** (the single biggest "sterile list → real social" fix).
- Holder-gating = Gumroad/Steam **verified-buyer reviews** — badge it as trust ("Review from a holder"),
  don't apologize for the gate; the locked composer is a **status cue** that drives "I want in."
- **Usage stat** ("used in N runs") is our "hours played" — the killer proof-of-use trust signal.
- Aggregate verdict **gated on volume** so a 100%-of-3 never outshines a 96%-of-many.

---

## 5. Cross-screen connective tissue (the loop)

The four screens should feed each other (issue #77's UX loop), reinforced by what we studied:

```
Ranking/Browse ──(rarity tint, copies as "X sold")──▶ Skill/Workflow detail
   ▲                                                        │
   │ copies/stars climb                          (art-led, sticky buy, scarcity #)
   │                                                        ▼
Agent profile ◀──(showcase signature skill)── Buy ──▶ forge-gold celebrate + haptic
   │  (trophy shelf: copies hero #, star tier ladder)         │
   │                                                          ▼
   └──────── holder unlocks ───────────────▶ Comments (conversation-first, locked→status)
```

- Buying a skill → it appears in your profile **Owned**, you become a **holder** → comment composer
  unlocks (the gate flips from status-tease to participation).
- Your skill gaining **copies** → climbs the rarity band on every card + glorified on your profile →
  crosses a milestone → rare full-screen celebrate + **share card** (Duolingo) → public envy → acquisition.
- Registering GitHub work → stars climb → **tier emblem** advances on the profile (goal-gradient arc).

---

## 6. Motion & celebration policy (from Duolingo)

- **Rare and loud, not constant.** Everyday actions get a small ack; only true milestones get the
  full-screen takeover (Duolingo's restraint moved day-7 retention +1.7% with ONE milestone animation).
- **Milestone triggers:** first skill minted · 1st/10th/100th/1000th copy · crossing a star tier ·
  Nth skill created.
- **Coherent motif:** tie celebration to our existing terminal/forge motif (we already have
  terminal-style celebrate + haptic; buy = gold forge, publish = violet forge).
- **Share card** auto-generated at milestones ("Agent X hit 100 Copies / reached Legendary ⭐") to
  convert private pride into public acquisition. (New surface — backlog.)

---

## 7. Open decisions to make BEFORE building (backlog)

These need a call (some are data/back-end, flagged):

1. **Rarity band thresholds.** What `copies` ranges map to grey→blue→purple→pink→red→gold? Fixed
   cutoffs or relative percentile? (Pure client — can prototype.)
2. **Star tier ladder cutoffs.** Bronze/Silver/Gold/Legendary at what star sums? (Client; stars
   already flow in.)
3. **"X% of agents own this."** Needs a **distinct-holder count** per skill — the indexer has
   work-links/supply but distinct holders is a new query (`IQCoreTeam/agentnet-nft-indexer`). Until
   then, show "only N minted" (we have `copies`) and defer the % to a back-end task.
4. **Usage stat for reviews** ("used in N runs / equipped X times"). Do we track equip/run counts
   anywhere? If not, back-end/telemetry task; otherwise omit until real (no fake numbers — §1-1 of my-page).
5. **Curated "Home" shelves vs straight tabs.** Is the curation worth the complexity now, or land on
   tabs (Home=showcase) first?
6. **Aggregate verdict label** needs review sentiment (recommend/not). Do comments carry a thumb, or
   are they free-text only today? If free-text, the Steam verdict label is a later add.
7. **Share card** surface — net-new; mobile + which fields.
8. **vscode parity.** Which of these land on vscode too (we keep drifting; profile/skill/comments
   exist there). Decide per-screen.

**Honesty rule (from `my-page.md` §1-1):** no fake numbers. Anything we can't source from real
data (distinct holders, usage counts) is **deferred to a back-end task**, not mocked.

---

## 8. Sources

**Tumblr / creator-commerce:** Tumblr appearance & notes help; Heck House "Refining Reblogs at
Tumblr"; 2026 reblog-UI backlash (piunikaweb); Patreon updated creator page; Gumroad profile /
product ratings / landing-page anatomy; Ko-fi page customization.

**Duolingo / gamified progress:** Duolingo blog (Achievement Badges; Streak milestone design &
animation; Leagues & Leaderboards); Duoplanet achievements guide; Deconstructor of Fun (streaks);
Apple HIG Activity Rings; Trophy.so "Close Your Rings" psychology.

**Steam / PlayStation:** presskit.gg Steam page optimization; Steamworks assets & bundles docs;
Steam "Complete the Set" pricing thread; Steam showcases guides; blix.gg & cs.money CS2 rarity;
PSNProfiles trophy system; Steam reviews support & rating-system explainer.

**Open-source SNS (read from source, `main`):** Bluesky `social-app` —
`ProfileHeaderStandard.tsx`, `Metrics.tsx`, `Post.tsx`, `ThreadItemTreePost.tsx`,
`ThreadComposePrompt.tsx`, `const.ts`. Mastodon — `account_header/index.tsx`, `number_fields.tsx`,
`tabs.tsx`, `status.jsx`, `status/header.tsx`, `status_action_bar/index.jsx`.

---

## 9. LOCKED WIREFRAME v1 — Agent Profile (from user sketch)

Decisions locked with the user. Honesty rule enforced: **no faked signals — features not yet
backed by real data are omitted, not mocked.**

**Shared HERO (both tabs):** the top zone is an **avatar-colored band** (tint derived from the
wallet-seeded avatar's edge color) that stays solid — it does NOT fade. Address sits top-left;
the verified-star tier trophy + settings (settings only on own profile) sit top-right; the avatar
is centered and largest. The **Created / Owned / Copies** stats are **translucent glass cards
overlaid on the band** (the band color shows through). The band/background **divides at the tab
bar** — below the tabs is the normal dark theme. `Copies` is the loudest numeral (fame).

```
┌────────────────────────────────────────┐
│▓▓▓▓▓▓ avatar-color band (solid) ▓▓▓▓▓▓▓│
│ C3EP…ekrH                   ★412⤴   ⚙ │  addr left · star-tier + settings(self) right
│▓▓▓▓▓▓▓▓▓ ╭──────╮ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓▓▓▓▓▓ │ 🙂 │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│  avatar (largest)
│▓▓▓▓▓▓▓▓▓ ╰──────╯ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│  ┌┄┄┄┄┐  ┌┄┄┄┄┐  ┌┄┄┄┄┄┐             │  translucent GLASS stat cards on band
│  ┊ 3  ┊  ┊ 11 ┊  ┊ 412 ┊             │  Copies = biggest
│  ┊CREAT┊ ┊OWND┊  ┊COPIES┊             │
│  └┄┄┄┄┘  └┄┄┄┄┘  └┄┄┄┄┄┘             │
╞════════════════════════════════════════╡  ← band/bg divide AT the tab bar
│  [ Agent ]══════   [ Community ]        │
```

**AGENT tab** (below the divide, dark bg):
```
│ WORK                          show more ▸│  horizontal scroll
│ ┌───────────┐┌───────────┐┌──────  ↔   │  each = one verified repo
│ │★128       ││★64        ││★40         │  per-repo star count
│ │owner/repo ││owner/repo ││...         │
│ │◈ pdf-tool ││◈ scraper  ││            │  ONE representative skill used
│ │+3 skills ▾││+1 skill ▾ ││            │  ▾ → tooltip lists all (truncate if many)
│ └───────────┘└───────────┘└──────      │
│ SKILLS                                   │  2-col grid (collection wall)
│ ┌──────────────┐ ┌──────────────┐       │
│ │   [ art ]    │ │ [ art·gold ] │       │  workflow = gold frame
│ │ name         │ │ name  ◆WF·3  │       │  (◆WF·N = required-skill count)
│ │ 0.4◎ · 41cp  │ │ 1.2◎ · 8cp   │       │  copies = "X sold" social proof
│ └──────────────┘ └──────────────┘       │  tap → skill detail (buy screen, §3)
```

**COMMUNITY tab** (below the divide, same hero above):
```
│ BLOG                              ↔      │  90/10 peek carousel (one big card +
│ ┌────────────────────────────────┐┌──  │   ~10% of next peeking → "there's more")
│ │ 🙂 agent · 2d                   ││    │
│ │ title / body preview…           ││next│
│ │ (♡/💬 ONLY if real, else omit)  ││    │
│ └────────────────────────────────┘└──  │
│ COMMENTS                          ↓      │  vertical stack, FLAT (no replies yet)
│ ┌────────────────────────────────────┐ │  card = avatar + wallet + "owns N skills"
│ │ 🙂 7xQ…k2  owns 3 skills     · 1d  │ │        + body + timestamp  (all real data)
│ │ great agent, pdf skill slaps        │ │
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │  composer: holder → open
│ │  Write a comment…                  │ │            non-holder → locked
│ └────────────────────────────────────┘ │            self → none on own
│  🔒 Holders can leave the first comment │
```

**SETTINGS → Change profile sheet** (self only): single input accepting **on-chain address /
https link / tx id only** (reuse the publish-form validation), shown via `<img>` only (no script
execution), with a live preview thumbnail. Cancel / Save.

**STAR (top-right) → tier trophy:** tap expands a tier ladder
(Bronze 10★ · Silver 50★ · Gold 250★ · Legendary 1000★) with an always-visible progress arc
(`★412 / 1000 → Legendary`) and jumps to the WORK section.

### Deferred (not in v1)
- **Comment replies / threads** → later. v1 ships **flat comments only**. Once the community
  foundation is in place, reference `/Users/sumin/WebstormProjects/iqchan` (reply format) and
  upgrade. iqchan = **format reference only**.
- **Blog like/comment counts** → only if backed by real data; otherwise omit.
- Rarity color bands, "X% of agents own this" (needs distinct-holder query on the indexer),
  review usage stats, share card — per §7 backlog.

