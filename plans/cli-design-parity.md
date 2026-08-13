# CLI design parity plan

Goal: bring `surfaces/cli` to full parity with the Claude Design project
"AgentNet CLI Screens" (project id `0d659b47-e785-4aa1-8474-467ab78505a1`,
read via the `claude_design` MCP), and port the agent directory / comments
system that today exists only in `surfaces/webview` (hosted by the VSCode
extension). After the pass, report per tab: **applied / adapted (why) /
skipped (why)**. Image attachment features are out of scope (terminal).

## Locked decisions (2026-08-11, with sumin)

- **Scope this pass**: tabs 01-09 + the 20-series (agent / market). The
  `NEXT`-prefixed concept tabs (11-14) are **deferred to a later pass** -
  14 (mouse) especially is low value in a terminal. Do not build 11-14 now.
- **Delivery**: this is big work, not small direct-to-main fixes. Do it on a
  feature branch, batch the commits (not per-tab direct pushes), open a PR
  whose body includes a mermaid diagram of the screen/nav model, then merge
  it immediately. Commit + PR text in English, no AI attribution.
- **Execution model**: this plan was written in a fable planning session.
  Re-run under Opus with "read plans/cli-design-parity.md and execute".

## Current state (2026-08-11)

- `main` at `71848a3`. The frame rework, transcript turns, cooking fix, ring
  on block, and fork session are all committed (`3b520a3`..`fc3586b`).
- Uncommitted (keep, commit first after a review): approval popup with
  native Approve/Deny buttons + overlay gap fix, in
  `surfaces/cli/src/InkApprovalChannel.ts`, `surfaces/cli/src/notify.ts`,
  `surfaces/cli/src/views/Chat.tsx`, `surfaces/vscode/src/approvalNotify.ts`,
  `surfaces/vscode/src/extension.ts`.
- `surfaces/android/setup-release-signing.sh` is untracked and belongs to
  another workstream. Do not touch or commit it.

## House rules (violating these caused every recent CLI bug)

1. All colors/glyphs/copy through `theme.ts` tokens. No emoji in product UI.
   No em-dash in any user-visible copy.
2. The live frame is fixed-height and must stay strictly shorter than the
   terminal (`ink` clears + reprints the whole transcript the moment
   `outputHeight >= rows`). Every band needs an explicit height budget;
   chrome rows are counted in `CHROME_ROWS` in `Chat.tsx`. One-line bands
   must enforce their one-line contract (see `StatusLine`, `ActivityRow`,
   `HistoryBand`).
3. `<Static>` items need an explicit width + hard wrap (ink's Static box is
   position:absolute and sizes to content, which spills into the margin).
4. Never unmount the Composer (drafts die); hide with `display="none"`.
5. Logic goes in `packages/core`; the CLI only sequences core exports.
6. Never render test harnesses to the real terminal. Verify offline with a
   captured stream / pure-function probes, then have the user smoke-test.
7. Commits in English, no AI attribution. This parity work is big: feature
   branch, batched commits, PR with a mermaid nav diagram, merge immediately
   (not per-tab direct-to-main). Phase 0's tiny approval-popup fix may still
   go direct to main before the branch is cut.

## Phase 0 - stabilize

- Review + commit the 5 pending approval-popup files.
- Fix the known `WelcomePanel` overflow (owned-skill list is uncapped and
  can exceed the frame budget on skill-rich wallets).

## Phase 1 - the matrix (DONE 2026-08-11, three parallel readers)

`00 All Screens` is an index. `10-14 NEXT` deferred. `uploads/*` are
screenshots. Every in-scope tab read against its CLI owner.

### Cross-cutting findings

- **Tokens already match.** `theme.ts` was reskinned to the exact design
  palette (bone `#ecebe4`, ink `#0a0a0b`, gray `#85857e`, green `#3fd96f`,
  gold `#e3b341`). Color parity is essentially done. Gaps are LAYOUT, COPY
  strings, and MISSING FLOWS - not colors. Reuse `tag()` for every `//LABEL_`.
- **Undefined design colors to add** (structural, not brand): `#4a4a46`
  locked-step gray, `#3a3a38` heavy rail / tab separator, `#2a2a28`
  scrolled-past header bg, `#101013` code-box bg, green-panel set `#0e1410`
  `#16201a` `#24352a` `#1a2a1f`, danger `#ff3b30` (vs current `err #f8514f`).
- **Two recurring architectural gaps** (the real "UI feels chaotic" root):
  1. Design overlays RISE ABOVE the composer with the chat still visible
     (tabs 28/30/31). CLI does full-frame `return` takeovers ("every overlay
     owns the whole frame", `Chat.tsx:~1049`). Inverting this is the single
     highest-value change.
  2. Design has a global nav (`CHAT/SKILLS/RANK/MARKET`, Ctrl+1..4) and
     MULTIPLE concurrent session tabs (Ctrl+T / Ctrl+arrows). CLI has one
     session and reaches modes only via slash-command full-screen overlays.

### Matrix

| Tab | CLI owner | State | Top gaps to close |
|---|---|---|---|
| 01 Boot | `app.tsx` boot, `Banner.tsx`, `BootChecklist.tsx`, `logo.ts` | partial | `//WALLET_ //CLAUDE_ //CODEX_ //STORAGE_` status bands, `OK ✓`/`CONNECTING…` copy, IQ block logo + `AGENTNET #CLI` title |
| 02 Onboarding | `views/Onboarding.tsx`, `Iggy.tsx` | partial | 5-rung numbered ladder (`✓/▶/○`), `step N of 5` + `████░░` meter, green `WALLET LINKED` band, mascot dialogue, badge copy `ready`/`needs a login` |
| 03 Welcome | `components/WelcomePanel.tsx` | partial (closest) | re-lay settings as stacked full-width `//TAG_` bands (`//ENGINE_` inverted), skills inline in a `//SKILLS_` band, fix `emptySessions` + footer copy |
| 04 Chat Turn | `Message.tsx`, `ToolCard.tsx`, `Markdown.tsx` | partial | reconcile `//YOU_` label vs inverted `TurnHeader`; tool card `#3a3a38` box + 4px bone left border; `+N LINES HIDDEN`; inline `esc to stop` |
| 05 Approval | `components/ApprovalCard.tsx` | partial | green `//REQUEST_` band header, 5-column key grid (`[D] TOGGLE DIFF` promoted), uppercase labels, `waiting for you` |
| 06 Model Picker | `views/ModelPicker.tsx`, `EffortPicker.tsx` | partial | 2-col split with `WHAT THIS ONE IS` detail pane, `PICK A MODEL` + green `NOW · X` title, invert selected row + `CURRENT` badge |
| 07 Sessions | `views/SessionList.tsx`, `ChipCarousel.tsx` | partial (diverges) | replace horizontal carousel with VERTICAL stacked rows (↑/↓), per-row `2h ago · 31k ctx · cwd` sub-line, `SYNC: GOOGLE DRIVE ◉`, `● LIVE` |
| 08 Skill Market | `views/SkillMarket.tsx`, `ChipCarousel.tsx` | partial | horizontal axis already exists; add notch/barcode/micro-mark/big-supply tile silhouette, `MARKET`/`N ON MAINNET` title, `//BUY_` band, footer legend |
| 09 Long Chat | `Chat.tsx` transcript, `Message.tsx` | partial | `● PINNED`/`SCROLLED PAST` header states, `SHOW MORE (N LINES)` collapse, `TURN n OF m` + `N messages · scrolled up` meta |
| 20 Agent Directory | inline in `SkillMarket.tsx` (717-765); no view file | missing (list exists, card grid missing) | 3-col agent card grid, self-pin `// YOU` + self-synthesis, 2x2 `CREATED/COPIES/STARS/EARNED`, per-agent gauge, ascii avatar, `//RANK_` bands. Port `AgentDirectory.tsx` order + `selfRep` |
| 21 Agent Profile | `views/market/AgentProfileView.tsx` | partial | stats `CREATED/COPIES/OWNED` (swap `notesReceived`→`ownedSkills`), `AGENT|COMMUNITY` tabs, `//BLOG_` band, ascii avatar. Self blog compose ALREADY exists |
| 22 Agent Comments | same file, `sub==="comments"` (read-only) | partial→missing-write | biggest delta: add reply + top-level comment composer; add `parentId` to `MarketApi.postAgentNote`; surface `canComment` gate (`⚠ GATED`/`YOU HOLD n`) |
| 23 Global Nav + Tabs | none (`app.tsx` phases; slash overlays) | missing | BIG: `CHAT/SKILLS/RANK/MARKET` nav (Ctrl+1..4); multi-session tabs (Ctrl+T, Ctrl+arrows, background ring). `RANK` surface doesn't exist |
| 24 Skill Detail | `views/market/SkillDetailView.tsx` | partial (strong) | `//ART_`/`//USED BY_`/`//BUY_` bands + royalty line, mint id + `↗ EXPLORER`/`↗ MAGIC EDEN`, rename `[U] UN-EQUIP`, `[G] REGISTER WORK` (needs core) |
| 25 Publish Forge | `SkillMarket.tsx` publish (767-815), `PublishProgressView.tsx` | partial (strong) | standalone forge screen, `//ITEM_`/`//NEXT_` bands, phase sub-copy, `SKILL MINTED` plaque + copy-mint + explorer, violet/amber tint |
| 26 Connections + Funding | none (scattered: `/wallet /storage /account`, `HeliusPanel.tsx`) | missing | unified account screen (wallet/cloud/rpc/github/versions); FUNDING panel on `insufficient_funds` (add `code` to `buySkill`, wire `airdrop()`). GitHub connect needs core-env additions |
| 27 Approval Variants | `ApprovalCard.tsx`, `notify.ts` | partial | Kind C danger + OSC9 exist; build Kind A QUESTION renderer (`req.questions`), Kind B PLAN renderer (`req.plan`); add 10-min auto-deny |
| 28 Bottom Chrome | `StatusLine.tsx`, `Composer.tsx`, `Footer.tsx` | partial | footer items `SESSIONS/MODEL` selectable (not `/NEW SESSION`), persistent `ready` label by face, sessions as rising panel not full overlay |
| 29 Hint Mode | none | missing | BIG: Ctrl+G letter-overlay target registry + activation (open file/url/picker). Adapt "hold" to toggle. Filenames/links not actionable today |
| 30 Footer Panel | `Chat.tsx` overlay returns (1055-1300), `Footer.tsx` | partial (inverted model) | convert full-frame Sessions/Model/Fork returns into ONE in-frame bottom panel slot that rises above the composer (`M`/`F`/`S` swap content) |
| 31 Fork Session | `Chat.tsx` `case "fork"`, `useChat.ts` forkSession | partial | 3-option FORK panel (up-to-here/whole/background), result row `✦ FORKED → S.NN` + `U` undo, in-chat "up to here" marker. Background-tab option blocked on tab 23 |

### Core/API glue needed (not just UI)

- `MarketApi.postAgentNote` drop of `parentId` -> add it (core supports). [22]
- `MarketApi.buySkill` drops `code` -> add, detect `insufficient_funds`. [26,08,24]
- Wire `marketplaceEnv.airdrop()` (devnet). [26]
- GitHub `submitGithubToken`/`getGithubStatus`/`registerWorkRepo`: message
  types exist but `marketplaceEnv` exposes none -> needs CORE additions. [24,26]

## Phase 2 - execution order (finalized 2026-08-13)

Ordered by CODE COHESION + dependency (not perceived impact, per sumin): same
file/module together, shared/base code before its consumers. Each item ships
with a QA checklist (what to smoke-test + what could regress) for sumin to
verify before the next. Contained items go direct to main; the big clusters
(panels, market, nav/hint) go on a branch -> merge.

### Already applied (on main as of e2757ab, CLI 0.1.2)
- 03 Welcome (stacked //TAG_ bands), 06 Model Picker (split frame),
  07 Sessions (vertical rows + age column), 04/09 transcript (calm //YOU_
  bands, tool nodes, code boxes, one-colour diff), foundation `theme.ts`
  tokens. Also non-design fixes this session: resize-OOM guard, session sort
  by last activity, background history backfill, mouse-reporting off, approval
  escalation popup.

### Remaining, in execution order

1. **Approval** (`ApprovalCard.tsx`, `InkApprovalChannel.ts`) - one cohesive
   file, 27 extends 05:
   - 05 card redesign: green `//REQUEST_` band, 5-col key grid, uppercase.
   - 27 variants: Kind A (question) + Kind B (plan) renderers; 10-min auto-deny.
2. **Startup** (`app.tsx` boot, `BootChecklist.tsx`, `Banner.tsx`; then
   `Onboarding.tsx`, `Iggy.tsx`) - shared startup + status-band/mascot:
   - 01 Boot: `//WALLET_//CLAUDE_//CODEX_//STORAGE_` bands, IQ logo, copy.
   - 02 Onboarding: 5-rung ladder, step counter, meter, wallet-linked band.
3. **Bottom chrome + panels** (`Footer.tsx`, `StatusLine.tsx`, then `Chat.tsx`
   overlay model) - the frame-architecture cluster, do carefully, QA hard:
   - 28 chrome: footer items `SESSIONS/MODEL`, persistent `ready` label.
   - 30 rising-panel architecture: full-frame Sessions/Model/Fork overlays ->
     one in-frame panel slot above the composer.
   - 31 Fork panel: plugs into 30's slot (background-fork option waits on 23).
4. **Market / agent** (core glue first, then `SkillMarket.tsx`, `market/*`):
   - core glue: `MarketApi.postAgentNote(parentId)`, `buySkill` `code`,
     `airdrop()` (additive; 22/26 depend on it).
   - 08 tiles -> 24 skill detail -> 25 publish forge -> 20 agent directory ->
     21 agent profile -> 22 comments compose (21/22 same file) -> 26 funding.
5. **Big subsystems, scope-gated** (new modules; confirm scope first):
   - 23 global nav + multi-session tabs, 29 hint mode. 31's background-fork
     unblocks once 23 lands.

Deferred by decision: 10-14 NEXT tabs.

## Phase 2 - apply, tab by tab

Cut a feature branch first (e.g. `cli-design-parity`). Work the matrix in
numeric order over the in-scope tabs (01-09, 20-series, 28-31); skip 11-14.
Batch the commits on the branch. Where the terminal cannot express the design
(hover, mouse, images), adapt deliberately and record the adaptation in the
matrix for the final report. When the branch is done, open one PR whose body
carries a mermaid diagram of the screen + nav model, then merge immediately.

## Phase 3 - agent system port

Reference implementation: `surfaces/webview/src/market/AgentDirectory.tsx`
(list + sort), `AgentProfileView.tsx` (compose path), backed by
`packages/core/src/chat/marketMessages.ts` (`AgentProfile`, `MarketMessage`;
threads arrive pre-grouped per GH #101) and the MCP tool
`post_agent_comment`. CLI targets:

- New `views/market/AgentDirectoryView.tsx`: agent list, sort orders copied
  from the webview, keyboard navigation, matches tab 20.
- Extend `views/market/AgentProfileView.tsx`: comment compose + reply (2-level
  cap), blog post compose for self, matching tabs 21/22.
- Check what market messages the CLI host already handles before adding
  requests: adding a market message means editing BOTH contract files and
  the per-surface handler (see `packages/core/src/chat/marketMessages.ts`
  and the CLI's market message handler).

## Phase 4 - report

Produce the final per-tab table: applied / adapted (why) / skipped (why).
Include the two known deliberate skips: image attachments, and any
mouse-only interactions that do not survive the terminal.

## Verification

Typecheck + `tsup` build per phase. Offline render probes only (fake stdout
with fixed rows/cols, assert frame height < rows and no width overflow).
User smoke-tests `node dist/cli.js` between phases.
