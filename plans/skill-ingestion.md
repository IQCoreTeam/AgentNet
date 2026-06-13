# Skill ingestion & run structure — design (issue #17, Task 2)

> Built on the research in [`skill-ingestion-research.md`](skill-ingestion-research.md).
> Settled model: reader-side verify, **no on-chain audit** (search.md §2c,
> onchain-format/tables.md §0). Mirrors the inject-at-start pattern of
> [`shared-memory.md`](shared-memory.md).

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

### Codex
- No SKILL.md / progressive disclosure — only `AGENTS.md` (research §3). So the verify
  instruction **and** its text go into our managed fenced block in
  `codexAgentsFile(cwd)`. Reuse the exact splice helpers (`spliceCodexBlock`, marker
  approach) from [`memory/convert/codex.ts`](../packages/core/src/memory/convert/codex.ts);
  use a distinct marker pair (`<!-- agentnet:skills:start/end -->`) so memory and skills
  blocks coexist.

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

### Codex (no on-demand mechanism)
- "On demand" can only mean: splice the active skill's text into the AGENTS.md skills block
  when the task needs it. Simplest correct v1: include `skill-shopping` text in the block
  every session (it's small and self-gating — "when you lack a capability…"). Bought skills
  get appended to the block on purchase.

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
- **Codex:** configure the same MCP server through `@openai/codex-sdk` thread options
  (Codex's MCP config), or expose the two operations as local commands the AGENTS.md text
  tells it to call. Claude is the primary target for v1; Codex MCP can follow.
- **Verify gate:** the §2 systemPrompt/AGENTS.md instruction makes the agent run `verify`
  over a candidate's `readSkillText` output *before* calling `buy_skill`. The gate is the
  buyer's agent (skin in the game), not a central authority (search.md §2c).

`SpawnOpts` in [`spawn.ts`](../packages/core/src/runtime/spawn.ts) gains optional skill
fields (enabled skill names, the mcp server handle, the verify append text) so
`createRuntime` passes them through.

---

## 5. Build order

1. `core/paths.ts`: add `claudeSkillsDir(cwd)`; reuse `codexAgentsFile(cwd)`.
2. `skill-market/ingest/`: `SkillSync.injectAtStart(cli, cwd)` + `convert/{claude,codex}`
   (mirror memory module). Bundled `verify.md` fallback.
3. `runtime/index.ts`: instantiate + call `skills.injectAtStart` beside memory's.
4. `runtime/spawn.ts`: thread `skills`, `systemPrompt.append`, `settingSources:['project']`,
   `mcpServers`, `allowedTools` into the Claude `query()` options; Codex via AGENTS.md.
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
