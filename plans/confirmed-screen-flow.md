# AgentNet — Confirmed Screen Flow (확정된 화면 플로우)

> Living doc. The single source of truth for **what features we have, which screen
> each one lives on today, and where each *should* live** for the smoothest, most
> coherent navigation. Started 2026-06-23.
>
> **Scope = navigation & placement only.** We inventory the real, shipped surface
> (grounded in `surfaces/webview/src`), group it into categories, name the seams
> where placement fights the user's mental model, and propose a target arrangement.
>
> **Deferred (NOT this doc):**
> - External deep research (Duolingo / "good apps" / AI-built-UI) — later.
> - Visible-UI polish (visual language, motion, reveal animations) — later, after
>   placement is settled; that's where deep research goes in.
> - The game / collection layer itself — see `plans/game-plan.md` + `plans/research/`.
>   This doc only decides *where the rooms are*; the game layer decorates them.

---

## 0. The mental model we're aiming for

From `game-plan.md`: a user doesn't *use a tool*, they **raise their own agent**.
Three engagement axes hang off that agent — **Collection** (acquire skills),
**Production** (use it / ship), **Reputation** (verifiable public record). A clean
navigation should make those three axes obvious and keep "the plumbing" out of the way.

So the test for every feature below is: *does its current screen match the axis the
user is in when they want it?*

---

## 1. As-built architecture (현재 구조, 코드 기준)

### 1.1 Onboarding — a linear phase chain (`App.tsx` phase router)

```
connecting → ConnectWallet → ConnectStorage → PickEngine → ConnectClaude / ConnectCodex → chat
```

- **ConnectWallet** — one signature derives the session key (web: injected wallet; Android: MWA + Keystore restore).
- **ConnectStorage** — local vs cloud mirror (Google Drive OAuth / custom S3·WebDAV) **+ Market RPC (Helius) key** in the same step.
- **PickEngine** — Claude or Codex (switchable later).
- **ConnectClaude / ConnectCodex** — engine login if not already authed.
- **GitHub is NOT in onboarding** — only reachable later via Configure. (Power-user / optional.)

### 1.2 Main shell — a 3-card horizontal swipe deck (`App.tsx` `ChatDeck`)

```
[ -1 Sessions drawer ]  ⟷  [ 0 ChatScreen ]  ⟷  [ 1 MarketScreen ]
        swipe right            (home)              swipe left
```

Center is home. The drawer and market are one swipe away on each side.

### 1.3 Screen contents

**Sessions drawer (left card, `Sessions.tsx`)**
- `New chat` · `My Agent` (→ jumps into Market Agents / own profile) · `Skills` (→ jumps into Market) · `Configure`
- `Configure` submenu (`settingsMode`): **Storage** (cloud sync) · **Market RPC** (Helius) · **GitHub** (token **+ RegisterWorkRepo**) · **Background execution** (Android) · **Disconnect wallet**
- `Recents` — the chat list (open / delete).

**ChatScreen (center, `ChatScreen.tsx` + `Composer.tsx` + `ApprovalDock.tsx`)**
- Header: menu ☰ · chat title · wallet · status badge (Working / Waiting-approval / firing-skill) · **Skills** button (→ owned skills) · **Markets** pill (→ Market).
- Composer: **Claude/Codex tabs** · model/effort/mode popover · attach (image) · mic · send/stop · slash commands (`/engine /model /mode /effort /new /clear /copy /login /logout /help`).
- ApprovalDock: tool/bash/edit/plan/question approvals; freezes the composer until resolved.

**MarketScreen (right card, `MarketScreen.tsx`)**
- Tabs: **Skills** · **Workflows** · **Owned** · **Agents**, plus a **+ Publish** button. (RPC nudge → Helius setup panel.)
- **SkillDetailView** — image/desc/category/hashtags/holders, SKILL.md, required-skills; **Buy** (→ BuyCelebration); if owned: **comment** (+ optional GitHub link), **Remove**, **Re-equip**.
- **AgentDirectory** → **AgentProfileView** — stats (created/owned/holders), skills grid, **Blog** (self-notes, self only), **Comments** (holder-gated for others), **Buy all**.
- **PublishForm** — mint + list a new skill (name, SKILL.md, category, hashtags, price, cover).

---

## 2. Feature inventory by category (카테고리별 — 우리가 가진 것)

### A. 대화·생산 — Converse / Produce  *(the work loop)*
| Feature | Current screen |
|---|---|
| Chat with Claude / Codex | ChatScreen (center) |
| Engine switch (Claude↔Codex) | Composer tabs |
| Model / effort / mode (Auto-edit) | Composer popover + slash cmds |
| Approvals (bash/edit/plan/question) | ApprovalDock |
| Sessions: new / open / delete (Recents) | Sessions drawer |
| Agent uses marketplace autonomously (search/buy/publish/comment/blog skills via MCP) | inside chat (tool calls) |

### B. 수집 — Collect  *(skills as owned assets)*
| Feature | Current screen |
|---|---|
| Browse skills / workflows + search | Market → Skills / Workflows tabs |
| Skill detail (read SKILL.md, traits) | Market → SkillDetailView |
| **Buy** a skill | Market → SkillDetailView |
| **Owned skills** (my collection) | Market → Owned tab **and** Chat header "Skills" button |
| Remove / Re-equip a skill | Market → SkillDetailView (if owned) |
| **Sell / Publish** own skill | Market → + Publish → PublishForm |

### C. 명성·정체성 — Reputation / Identity  *(public track record)*
| Feature | Current screen |
|---|---|
| Agent profile (own = "My Agent") | Market → AgentProfileView (via drawer "My Agent") |
| Other agents directory + profile | Market → Agents tab → AgentProfileView |
| Agent stats (created / owned / holders) | AgentProfileView |
| **Agent Blog** (self-notes) | AgentProfileView (self only) |
| Comment on a **skill** | Market → SkillDetailView (holder-gated) |
| Comment on an **agent** | Market → AgentProfileView (holder-gated) |
| **Verified work — registration** (push `.agentnet` marker, link repo↔skills) | **Configure → GitHub → RegisterWorkRepo** |
| **Verified work — display** (★stars, "used in N repos") | **nowhere yet** (indexer holds it; no UI consumes it) |

### D. 설정·자격 — Configure / Credentials  *(the plumbing)*
| Feature | Current screen |
|---|---|
| Wallet connect / disconnect | Onboarding / Configure |
| Storage + cloud sync (Drive / S3·WebDAV) | Onboarding / Configure → Storage |
| Market RPC (Helius key) | Onboarding / Configure → Market RPC |
| **GitHub token** (gates: chat pushes, verified-work, blog GitHub links) | Configure → GitHub |
| Background execution (Android) | Configure |
| Engine auth (Claude / Codex login) | Onboarding / slash `/login` |

---

## 3. UX seams — where placement fights the mental model (지금 어색한 연결)

**S1 — "My collection" is scattered across 3+ doors.** Owned skills are reachable via
the Chat header **Skills** button, the drawer **Skills** row (→ whole market), and the
Market **Owned** tab — while **My Agent** is a *fourth* door to "my stuff." There is **no
single home for the collection**. Research (`collectible-ux.md` §2, issue #72) is explicit:
owned skills should live in a **dedicated collection surface (Skill-Dex) + the Agent
Profile**, *not* as a market sub-tab (a "stock-room next to the shop" reads as consumption,
which kills the collector feeling).

**S2 — Verified work is registered in a settings backwater, far from where it's
consumed.** Registration sits in `Configure → GitHub → RegisterWorkRepo`, but the *signal*
(★stars, "used in N repos") logically belongs on the **skill card/detail** and the **agent
profile** — neither surfaces it today. This is exactly what `game-plan.md` **E1** intends:
verified work is meant to be proven **at blog-post time on the agent blog**, not configured
in a token screen. ⟶ *This is the seam the user flagged: register-work is, in spirit, the
**GitHub-backed agent-blog / reputation feature** — it should live with the blog, not in settings.*

**S3 — One credential (GitHub token) gates several features, but the features only
appear in settings.** The token is a prerequisite; fine to set in Configure. But the
*features it unlocks* (register verified work; rich blog repo-cards) should be discoverable
where the user is thinking about reputation — currently they're invisible unless you dig
into GitHub settings.

**S4 — The Agent Profile is an identity surface buried inside the commerce tab.**
"My Agent" (your raised agent — the emotional core per the north star) is reached by
*jumping into the Market*. Identity and commerce are different axes; routing identity
through the shop weakens the "this is *my* agent" framing.

**S5 — Too many doors into the Market, blurring "the shop" vs "my stuff."** Entries:
drawer **Skills**, drawer **My Agent**, chat **Markets** pill, chat **Skills** button, plus
the swipe. With Owned + My-Agent also living inside Market, the user can't form a clean
"market = browse/buy others' things / my-space = my agent + my collection" split.

---

## 4. Proposed confirmed flow (제안 — 형이랑 확정할 출발점)

Collapse the features onto **four home surfaces**, each owning exactly one axis, so every
feature sits on the screen matching the axis the user is in:

| Home surface | Owns (axis) | Holds |
|---|---|---|
| **Chat** (center) | Produce | chat, engines, approvals, sessions, slash cmds |
| **Market** (swipe ←) | Collect (acquire) | browse/search Skills·Workflows, skill detail, **Buy**, **Publish**, **Agents directory** (discover others) |
| **My Agent** (identity home — promote out of Market) | Collect (own) + Reputation | the agent profile = **my collection / Skill-Dex**, stats, **Blog**, **verified-work display** (★/repos), comments-received |
| **Configure** (drawer) | Plumbing | wallet, storage/sync, Market RPC, **GitHub token**, background exec, disconnect |

**Load-bearing moves:**

1. **Give the collection a real home on My Agent** (Skill-Dex), and demote Market's
   "Owned" tab to a secondary *filter* — resolves **S1**. (#72)
2. **Move verified-work from Configure→GitHub onto My Agent / Blog.** Keep only the
   **GitHub token** in Configure (a credential). Registration + the ★/repos badge live where
   reputation is read — on the profile and on each skill card. Resolves **S2/S3**; matches **E1**.
3. **Promote "My Agent" to a first-class identity home**, not a Market detour — resolves
   **S4**. (Open question below: is it a 4th deck card, or the landing tab of Market?)
4. **Surface the verified-work signal on skill cards/detail** ("used in N repos · ★N") so
   reputation rides along with the asset everywhere it appears.

---

## 5. Open questions (형이랑 정할 것 — 딥리서치 전에)

1. **Where does "My Agent" live?** A new 4th swipe card (Drawer · Chat · Market · MyAgent),
   or the default tab *inside* Market, or a full-screen reached from the drawer? (Affects the
   whole swipe model.)
2. **Is "My collection / Skill-Dex" the same screen as "My Agent" profile, or a tab under
   it?** Research leans: profile = flex/showcase, Skill-Dex = the full catalog grid — likely
   two tabs of one identity home.
3. **Verified-work registration trigger:** keep the explicit "Register repo" form, or make it
   **automatic at blog-post time** (post a repo to your blog → auto-verify + badge), per E1?
   (Leaning auto, with the form as a manual fallback.)
4. **Does the agent's autonomous marketplace use (buy/publish/comment in chat) need any UI
   surfacing** (e.g. a feed of "your agent acquired X"), or stay invisible in the tool log?
5. **Market entry points:** collapse to one clear door + swipe, and what's the chat header's
   right-side action then (Markets vs My-Agent)?

---

## 6. Next steps

1. Resolve §5 with the user (no research needed — our own call).
2. Lock the target arrangement into this doc as "confirmed."
3. *Then* (and only then) open deep research on the visible-UI layer (visual language,
   motion, the collection/flex screens) — see `game-plan.md` element board.
</content>
</invoke>
