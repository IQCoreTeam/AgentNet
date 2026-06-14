# Skill ingestion & run structure — design (issue #17, Task 2)

> Built on the research in [`skill-ingestion-research.md`](skill-ingestion-research.md).
> Settled model: reader-side verify, **no on-chain audit** (search.md §2c,
> onchain-format/tables.md §0). Mirrors the inject-at-start pattern of
> [`shared-memory.md`](shared-memory.md).
> The **active** half (§3) is validated against a shipped reference skill — see §8;
> the open work is the **passive** `verify` mechanism (§2) + the buy/verify gate (§4, §7).

---

## 0. The model in one line

A **passive** skill (`verify`) is force-loaded into every session as an always-on
instruction; an **active** skill (`skill-shopping`, bought skills) is made discoverable and
pulled on demand. Buy + verify run against the existing market MCP tools
(`search_skills` / `buy_skill`), which we now wire into the spawned engine.

---

## 1. Where it plugs in

A new `SkillSync` orchestrator, the sibling of `MemorySync`
([`memory/index.ts`](../packages/core/src/memory/index.ts)), wired into `createRuntime`
([`runtime/index.ts`](../packages/core/src/runtime/index.ts)) right beside the existing
`memory.injectAtStart` call — **before** `spawnCli`:

```
const skills = new SkillSync(wallet, storage);
...
await memory.injectAtStart(opts.cli, opts.cwd);   // existing (#18)
await skills.injectAtStart(opts.cli, opts.cwd);    // new (#17) — best-effort, same try/catch
const cli = spawnCli({ ...opts, /* + skill spawn opts, see §4 */ });
```

New module: `packages/core/src/skill-market/ingest/` (or `skills/`), with `index.ts`
(`SkillSync`) + `convert/claude.ts` + `convert/codex.ts`, matching the memory module's
layout. Path helpers added to [`core/paths.ts`](../packages/core/src/core/paths.ts) (see §2).

---

## 2. Passive skill (`verify`) — force-load every session

Per-runtime, because the two engines differ (research §4):

### Claude
- **Instruction (always-on):** add `verify`'s directive to `query()`
  `systemPrompt: { type:'preset', preset:'claude_code', append: <verify-instruction> }`
  in [`spawn.ts`](../packages/core/src/runtime/spawn.ts). The append says: *"Before buying
  or equipping any marketplace skill, run the `verify` skill over its text and act on the
  result."* This is what makes verify run unasked — a SKILL.md alone is on-demand
  (research §1).
- **Skill body (available):** write `verify/SKILL.md` into the project skills dir
  (`<cwd>/.claude/skills/verify/SKILL.md`) and enable it via `skills: ['verify', …]`.
  Requires `settingSources` to include `'project'`.
- New paths: `claudeSkillsDir(cwd)` → `<cwd>/.claude/skills`.

### Codex (0.139.0 — supports SKILL.md natively, research §3)
- **Skill body (available):** write `verify/SKILL.md` into a Codex skill root —
  `~/.codex/skills/verify/SKILL.md` (`$CODEX_HOME/skills`) or `<cwd>/.agents/skills/verify/`.
  Codex auto-discovers it and injects it into the always-on `## Skills` list (name +
  description + path); body pulled on demand. Mind the **2% skills context budget**.
- **Instruction (always-on, the only per-runtime split):** Codex skills are model-invoked,
  and `disable-model-invocation` is the *opposite* of what we want — so the "always run
  verify before buy/equip" directive goes in our managed fenced block in
  `codexAgentsFile(cwd)`, reusing `spliceCodexBlock` from
  [`memory/convert/codex.ts`](../packages/core/src/memory/convert/codex.ts) with a distinct
  marker pair (`<!-- agentnet:skills:start/end -->`) so memory + skills blocks coexist.
- New paths: `codexSkillsDir()` → `$CODEX_HOME/skills` (default `~/.codex/skills`).

### Source of the verify skill
`verify` is itself a skill in the net (dogfooding — search.md §2c). `SkillSync` loads its
text via the existing `readSkillText` ([`skill-market/index.ts`] / `nft/index.ts`), with a
bundled fallback `verify.md` if the net is unreachable (verify must never be absent — it's
the safety gate). Bundled fallback lives next to `skill-shopping.md`.

---

## 3. Active skill — discover + load on demand

### Claude (native progressive disclosure)
- Enable known active skills via `skills` (e.g. `['verify','skill-shopping']`) +
  `settingSources:['project']`. The model pulls the full body through the Skill tool only
  when the task needs it — no extra work from us.
- A **bought** skill (its text fetched via `readSkillText` after `buy_skill`) is written to
  `<cwd>/.claude/skills/<name>/SKILL.md` so it becomes discoverable next turn/session.

### Codex (native SKILL.md discovery — same as Claude)
- Write active skills (`skill-shopping`, bought skills) into `codexSkillsDir()` /
  `<cwd>/.agents/skills/<name>/SKILL.md`. Codex auto-discovers, lists them in `## Skills`,
  and pulls the body on demand — no AGENTS.md splicing needed for skill *bodies*. A bought
  skill's text (via `readSkillText` after `buy_skill`) is written there so it's discoverable
  next turn/session. Watch the 2% skills budget — write skills, don't dump everything.

### The shopping flow (unchanged content, now wired)
[`skill-shopping.md`](../packages/core/src/skill-market/skill-shopping.md) already drives:
identify missing capability → `search_skills` → evaluate → `buy_skill` (soulbound). Our job
is only to (a) make it loaded per §3 and (b) make the two tools callable per §4, and (c)
gate the buy behind verify per §2.

---

## 4. Buy + verify wired to the market MCP tools

The surface exists but is unwired (research §1, confirmed in `spawn.ts`).

- `createAgentMcpServer(conn, signer, defaultCreatorWallet)`
  ([`skill-market/index.ts:151`](../packages/core/src/skill-market/index.ts)) returns a
  low-level `@modelcontextprotocol/sdk` `Server` exposing `search_skills` + `buy_skill`
  (`getAgentNetTools` / `handleToolCall`).
- **Claude:** pass it through `query()` `mcpServers: Record<string, McpServerConfig>` and
  allow the tools via `allowedTools: ['mcp__agentnet-marketplace__search_skills',
  'mcp__agentnet-marketplace__buy_skill', …]`. **Bridge needed (verified in
  `sdk.d.ts`):** the SDK's in-process MCP config is `McpSdkServerConfigWithInstance`
  (`type:'sdk'`, `instance: McpServer`), produced by the exported
  `createSdkMcpServer(opts)` (sdk.d.ts:485). Our `createAgentMcpServer`
  ([`skill-market/index.ts:151`](../packages/core/src/skill-market/index.ts)) returns a
  **low-level `@modelcontextprotocol/sdk` `Server`**, not the SDK's high-level `McpServer`,
  so don't wrap it — **re-register the two tools through `createSdkMcpServer`**, reusing
  `getAgentNetTools()` for the tool schemas and `handleToolCall(...)` for the logic
  verbatim. Net: a thin `createAgentSdkMcpServer()` adapter in `skill-market/`.
- **Codex:** `ThreadOptions` exposes **no** `mcpServers` (verified in
  `@openai/codex-sdk@0.139.0` `dist/index.d.ts`). Codex MCP is configured via TOML —
  `CodexOptions.config` (`--config` overrides → `~/.codex/config.toml` `mcp_servers.*`), or
  the user's `~/.codex/config.toml` / `codex mcp add`. So wiring our market tools into Codex
  means registering an `mcp_servers` entry (stdio command to a small AgentNet MCP binary, or
  `codex mcp-server` style). Heavier than Claude's in-process path — **Claude is the v1
  target; Codex MCP follows.** (Note: `ThreadOptions` also has no `systemPrompt`/`instructions`
  field — confirms the passive directive must go through AGENTS.md on Codex, §2.)
- **Verify gate:** the §2 systemPrompt/AGENTS.md instruction makes the agent run `verify`
  over a candidate's `readSkillText` output *before* calling `buy_skill`. The gate is the
  buyer's agent (skin in the game), not a central authority (search.md §2c).

`SpawnOpts` in [`spawn.ts`](../packages/core/src/runtime/spawn.ts) gains optional skill
fields (enabled skill names, the mcp server handle, the verify append text) so
`createRuntime` passes them through.

---

## 5. Build order

1. `core/paths.ts`: add `claudeSkillsDir(cwd)` (`<cwd>/.claude/skills`) and `codexSkillsDir()`
   (`$CODEX_HOME/skills`, default `~/.codex/skills`); reuse `codexAgentsFile(cwd)` for the
   passive directive only.
2. `skill-market/ingest/`: `SkillSync.injectAtStart(cli, cwd)` + `convert/{claude,codex}`
   (mirror memory module). Both converters write SKILL.md into the runtime's skills dir;
   the Codex converter additionally splices the always-run directive into AGENTS.md. Bundled
   `verify.md` fallback.
3. `runtime/index.ts`: instantiate + call `skills.injectAtStart` beside memory's.
4. `runtime/spawn.ts`: Claude — thread `skills`, `systemPrompt.append`,
   `settingSources:['project']`, `mcpServers`, `allowedTools` into `query()`; Codex — skills
   auto-discovered from `codexSkillsDir()`, directive via AGENTS.md.
5. MCP bridge for `createAgentMcpServer` → claude-agent-sdk `mcpServers`.

---

## 6. Verification

- Unit: `SkillSync` writes `verify/SKILL.md` under `claudeSkillsDir` and a fenced skills
  block into `AGENTS.md` (assert markers + idempotent re-splice), mirroring
  `test-memory.ts`.
- Integration: start a Claude session, confirm `verify` + `skill-shopping` appear in the
  skill listing and `search_skills`/`buy_skill` are callable (allowedTools).
- E2E: give the agent a task needing an unowned capability → it searches, runs verify over
  the candidate text, then buys — buy never fires before a verify pass.
- Codex: confirm the skills block lands in `AGENTS.md` alongside the memory block without
  clobbering it.

---

## 7. Open risks / unverified (resolve during implementation)

These are assumptions the design rests on but that are **not yet verified** — runtime-tested
or, for #1–#2, not yet decided. Listed worst-first.

1. **`verify` skill does not exist yet.** Only
   [`skill-shopping.md`](../packages/core/src/skill-market/skill-shopping.md) is in the repo.
   The entire passive flow assumes a `verify` SKILL.md is authored (and published to the net,
   or bundled as fallback). **Action:** author `verify/SKILL.md` before any of this works;
   decide net-published vs bundled-only.
2. **Passive verify is a soft instruction, not a hard gate.** `systemPrompt.append` /
   AGENTS.md "always verify before buy" can be skipped by the model (the leaked harness §1b
   leans on heavy *repeated* reminders for exactly this reason). If verify must be guaranteed,
   it needs **code enforcement** — e.g. `handleToolCall` rejects `buy_skill` unless a verify
   pass for that `skillId` was recorded this session. **Decide:** soft directive vs hard
   interception. Recommend hard for a safety gate.
3. **Claude `skills` + freshly-dropped project skill timing.** Design writes
   `verify/SKILL.md` in `injectAtStart` then spawns with `skills:[…]` +
   `settingSources:['project']`. Grounded in `sdk.d.ts`, but **not runtime-tested** that the
   SDK rescans `.claude/skills` after our write on the same spawn. **Verify:** the skill
   appears in the session's listing. → **Corroborated as real:** last30days ships a STEP 0
   guard for exactly this (Claude Code's marketplace clone lagging the cache — §8a).
4. **Codex skills scan via the SDK path.** The 0.139.0 binary has the `core-skills` loader
   (research §3), but it's **assumed** that a `@openai/codex-sdk` `Thread` run triggers the
   same `~/.codex/skills` / `.agents/skills` scan as the interactive CLI. **Verify** with a
   live Codex thread.
5. **2% skills context budget.** Read from the binary string "Exceeded skills context budget
   of 2%"; exact semantics (2% of which window, overflow behavior — drop? error?) **inferred,
   not confirmed.** Matters if many bought skills accumulate. **Verify** the cap + failure mode.
6. **MCP bridge is a sketch.** `createSdkMcpServer` exists (sdk.d.ts:485) and our `Server` is
   low-level, so the re-register plan is sound — but the adapter isn't written and the
   `getAgentNetTools()` schema → SDK tool-def shape mapping is **unverified**. **Build + test**
   the `createAgentSdkMcpServer()` adapter in isolation first.
7. **Codex MCP is heavier than Claude's.** No in-process option — needs an `mcp_servers` TOML
   entry pointing at a stdio MCP binary (§4). The "small AgentNet MCP binary" doesn't exist;
   scope it or defer Codex MCP past v1 (Claude-first).

---

## 8. OSS validation — a shipped reference for the *active* half

Two repos were surveyed for how real skills are built. One confirms our active model end
to end; the other is a different layer entirely (recorded so we don't mistake it for a skill).

### 8a. `mvanhorn/last30days-skill` — our active model, already shipped (41k★)

A production agentskills.io skill (cross-platform "what people said in the last 30 days"
research). It is the **active / on-demand** half of §3 **as a working artifact**, so the
active design needs no further research — only implementation. Point-for-point match:

| Our design (§3) | last30days (verified in-repo) |
|---|---|
| agentskills.io folder layout | `skills/last30days/` = `SKILL.md` + `scripts/` + `references/` + `assets/` |
| active = discovered-then-pulled | frontmatter `name`+`description`+`user-invocable:true`; body Read on `/last30days` or topic match |
| multi-runtime via skills dir | `npx skills add … -a codex` installs to `~/.codex/skills/`; Claude via `.claude-plugin/` — **confirms Codex 0.139 native SKILL.md discovery (research §3) is real** |
| progressive disclosure | SKILL.md says *"Read `references/save-html-brief.md` BEFORE proceeding"* — lazy-loads sub-files exactly like research §3b's 3 stages |
| thin LLM contract + heavy engine | SKILL.md is the contract; `scripts/last30days.py` does the work ("You ARE the planner" — LLM emits a JSON plan, headless engine runs it) |

**New, beyond our design — patterns to adopt when authoring `verify`/`skill-shopping`:**
- **`SKILL_DIR` self-location.** The engine path is "the dir the harness loaded SKILL.md
  from — no resolver list, no precedence walk." Lets one skill run on any host without us
  enumerating each runtime's install path. **Adopt** for any bundled scripts.
- **STEP 0 stale-clone self-check.** A guard at the top of SKILL.md detects Claude Code's
  `~/.claude/plugins/marketplaces/` git clone lagging the versioned cache and re-Reads the
  correct copy. → This is **direct evidence that §7 risk #3 (does the SDK pick up a
  freshly-dropped skill?) is a real, dated bug**, not a hypothetical. Test it.
- **Contract hoisted to the top + dated failure log.** Output rules sat ~line 1094 and Opus
  drifted to blog format, so they hoisted a mandatory first-line contract and log failures
  with dates ("2026-04-18 v3.0.6 0/8 regression") — a versioned, regression-tested prompt.
  **Adopt** for `verify` (its instruction is a safety contract — put the rule first, log
  drift).

**Note — installer ecosystem:** last30days rides the open **`npx skills add`** CLI (one
command installs to 50+ hosts' skills dirs). Open decision for us: write our own
manifest-per-host inject (the §1–§3 `SkillSync` path, full control, soulbound-aware) vs lean
on that CLI for distribution. Our skills are **bought on-chain, not registry-published**, so
`SkillSync` (write `readSkillText` output into the skills dir ourselves) stays the core path;
the `npx skills` ecosystem is at most a distribution convenience for our *free/bundled*
skills (`verify`, `skill-shopping`), not the buy flow.

### 8b. `chopratejas/headroom` — NOT a skill (a context-compression layer)

Recorded to avoid confusion: headroom has **no SKILL.md / no `skills/` dir**. It's an infra
product (compress tool-outputs/logs/RAG 60–95% before the LLM) that attaches via **plugins +
hooks** (Claude Code `hooks.json` SessionStart/PreToolUse, OpenClaw context-engine, Hermes
plugin) — a *different mechanism* from skill ingestion, out of scope for #17.

One idea worth filing for **later, unrelated to #17**: its **CCR (Compress-Cache-Retrieve)**
pattern — compress content, cache the original under a hash, leave an inline `hash=…` marker,
and inject a `retrieve(hash)` tool so the model pulls the original on demand. That's
*progressive disclosure for data*, and could apply if a **bought skill's body is large**
(code-in chunked > 700B): inject a short summary + a tool to fetch the full `skillText`,
instead of dumping the whole body. Not part of this design — noted so the pattern isn't lost.
