# Skill ingestion — OSS research (issue #17, Task 1)

> Sibling: [`search.md`](search.md) §2c (reader-side verify) ·
> [`skill-nft-structure.md`](skill-nft-structure.md) ·
> [`skill-market/skill-shopping.md`](../packages/core/src/skill-market/skill-shopping.md)
> · [`shared-memory.md`](shared-memory.md) (the inject-at-start pattern we mirror).
>
> **This is Task 1: research only — no design decisions are settled here.** Goal: write
> up how each agent runtime reads/treats skill `.md` files, enough to choose AgentNet's
> passive (`verify`) + active (on-demand) loading mechanism in
> [`skill-ingestion.md`](skill-ingestion.md) (Task 2).

---

## 0. Why this first

We have marketplace plumbing (publish / buy / search / `readSkillText`, MCP surface
`createAgentMcpServer` / `getAgentNetTools` / `handleToolCall` in
[`skill-market/index.ts`](../packages/core/src/skill-market/index.ts)) but no defined
**ingestion/run** structure. Two skill kinds must be supported:

- **Passive — always on.** Canonical: `verify`. Loaded every session, runs unasked to
  vet a candidate skill's text before buy/equip (reader-side; **no on-chain audit** —
  search.md §2c, onchain-format/tables.md §0).
- **Active — sometimes on.** Loaded only when the task needs it. Canonical: the existing
  `skill-shopping.md` (search market → `buy_skill`).

We can't pick the mechanism without knowing how each target runtime handles `.md` skill
files. The survey below is grounded in the SDK type defs and live behavior verified in
this repo, not from memory.

---

## 1. Claude Code / `@anthropic-ai/claude-agent-sdk` (v0.3.170, the version we ship)

This is the runtime we already drive in
[`runtime/spawn.ts`](../packages/core/src/runtime/spawn.ts) via `query()`.

### SKILL.md shape
- A skill is a directory `<skill-name>/SKILL.md` with **YAML frontmatter** + markdown body.
- Frontmatter requires `name` (≤64 chars, `[a-z0-9-]`) and `description` (≤1024 chars,
  non-empty). Our [`skill-shopping.md`](../packages/core/src/skill-market/skill-shopping.md)
  already matches this shape (`name`, `description`, plus extra fields it tolerates).

### Where skills load from
- User: `~/.claude/skills/` — `claudeHome()` in
  [`core/paths.ts`](../packages/core/src/core/paths.ts) is `~/.claude` (override
  `CLAUDE_CONFIG_DIR`).
- Project: `.claude/skills/` under the session cwd.
- Plugins: `plugin:skill` qualified names.

### Always-on vs on-demand (progressive disclosure)
- **Always-on layer (tiny):** at session start the runtime preloads ONLY each skill's
  `name` + `description` (from frontmatter) into the system prompt. Hundreds of skills
  cost almost no context.
- **On-demand layer:** when the model decides a skill applies, it reads the full
  `SKILL.md` (and any files it references) into context via the `Skill` tool / bash. The
  body is not in context until triggered.
- Consequence for us: **a SKILL.md alone is on-demand by nature.** "Always runs before
  buy" (passive `verify`) cannot come from merely placing a SKILL.md — it needs an
  always-on *instruction* in the system prompt / CLAUDE.md that says "always verify
  first," with the verify skill available for the model to pull.

### The SDK seams (verified in `claude-agent-sdk/sdk.d.ts`, the `Options` type)
| Option | What it controls | Relevance |
|---|---|---|
| `skills?: string[] \| 'all'` | **THE single place to enable skills.** Names = SKILL.md `name`/dir, or `plugin:skill`. Don't add `'Skill'` to `allowedTools` yourself. Context filter, not a sandbox. | Active skills: enable `['verify','skill-shopping', …]`. |
| `settingSources?: SettingSource[]` (`'user'`/`'project'`/`'local'`) | Which on-disk settings to load. **Must include `'project'` to load CLAUDE.md.** `[]` = SDK isolation. | Needed if we use project `.claude/skills/` + CLAUDE.md for the always-on instruction. |
| `systemPrompt` | `string` (custom) \| `string[]` (with cache boundary) \| `{type:'preset',preset:'claude_code',append?}` | Always-on `verify` instruction goes in `append`. |
| `mcpServers?: Record<string,McpServerConfig>` | In-process / external MCP servers. | Wire `createAgentMcpServer` here for `search_skills`/`buy_skill`. |
| `allowedTools` / `disallowedTools` | Permit/deny tools. | Allow the MCP market tools. |

**Current state:** [`spawn.ts`](../packages/core/src/runtime/spawn.ts) `query({ options })`
passes `resume`, `model`, `cwd`, `canUseTool`, `pathToClaudeCodeExecutable`, `stderr` —
**none of `skills` / `systemPrompt` / `settingSources` / `mcpServers`.** This confirms the
issue note: the MCP surface is exported but not wired into runtime spawn. These five
options are the entire wiring surface for Task 2.

---

## 2. Hermes (NousResearch/hermes-agent)

- **SKILL.md-compatible by design.** Skills are markdown + YAML frontmatter (`name`,
  `description`, `version`, `author`, required env vars / credential files). Same opening
  `---` YAML block, markdown body convention as Claude.
- **Discovery:** scans `~/.hermes/skills/` (the primary tree it also writes through via
  `skill_manage`) plus any `skills.external_dirs` listed in `config.yaml`. So passive
  presence = drop a skill into a scanned dir.
- **Cross-agent portability:** skills authored for Claude Code, Cursor, or Codex CLI work
  in Hermes unmodified; agent-specific frontmatter (e.g. Claude's `context: fork`, Cursor
  globs) is **ignored**, but the markdown body + supporting files (references, scripts,
  examples) are used as-is.
- Takeaway for us: a single canonical `SKILL.md` (frontmatter + body) is portable across
  Claude + Hermes + Codex/Cursor if we keep extra fields tolerated-and-ignored — which is
  exactly how `skill-shopping.md` is already written.

---

## 3. Other runtimes — how each takes `.md` into context

| Runtime | Mechanism | Always-on vs on-demand | Frontmatter / discovery |
|---|---|---|---|
| **Codex CLI** (we drive it via `@openai/codex-sdk`) | Reads **`AGENTS.md`** at the session cwd (global + repo concatenated) at session start. **Inject-only** — stock codex never writes memory (verified in [`memory/convert/codex.ts`](../packages/core/src/memory/convert/codex.ts), codex-cli 0.139.0). No SKILL.md tool / progressive disclosure. | **Always-on only** — whatever is in AGENTS.md is in context every turn; no on-demand pull mechanism. | Plain markdown, no frontmatter discovery. We own a fenced `<!-- agentnet:… -->` block. |
| **Cursor** | `.cursor/rules/*.mdc` with frontmatter (`description`, `globs`, `alwaysApply`). | `alwaysApply: true` = always-on; otherwise injected when a glob/agent-decision matches = on-demand. | YAML frontmatter; per-rule glob targeting. |
| **Claude `CLAUDE.md`** (same runtime as §1, different file) | Project/user `CLAUDE.md` concatenated into the system prompt (loaded when `settingSources` includes `'project'`). | **Always-on**, no discovery — closest analog to Codex AGENTS.md. | No frontmatter; plain instructions. |

---

## 4. The two ingestion idioms (what the survey converges on)

Every runtime above is one of two shapes:

1. **System-prompt / file injection (always-on).** Codex `AGENTS.md`, Claude `CLAUDE.md`,
   Cursor `alwaysApply` rules. Content is in context every turn, no model decision, no
   discovery. → This is how a **passive** skill (`verify`) must be delivered.
2. **Discovered-then-pulled (on-demand, progressive disclosure).** Claude/Hermes
   `SKILL.md`: only `name`+`description` always-on; full body pulled when the model
   judges it relevant. → This is how an **active** skill (`skill-shopping`) is delivered.

**Crucial asymmetry for our two target runtimes:**
- **Claude** has *both* idioms (CLAUDE.md/`systemPrompt.append` for passive; `skills` +
  Skill tool for active).
- **Codex** has *only* idiom #1 (AGENTS.md). It has no SKILL.md/progressive-disclosure
  concept — so for Codex, **both** passive and active skills collapse to "text in
  AGENTS.md," and "on-demand" can only mean "we splice the active skill's text in before
  the turn that needs it."

This mirrors exactly the Claude-rich / Codex-inject-only split already handled for shared
memory ([`memory/index.ts`](../packages/core/src/memory/index.ts),
[`shared-memory.md`](shared-memory.md)).

---

## 5. Reusable precedent in this repo (do not reinvent)

`MemorySync.injectAtStart(cli, cwd)` in
[`memory/index.ts`](../packages/core/src/memory/index.ts), wired into `createRuntime`
([`runtime/index.ts`](../packages/core/src/runtime/index.ts)) **before** `spawnCli`, already:
- writes canonical content into Claude's per-project files (`claudeMemoryDir`) for Claude,
- splices a fenced block into `AGENTS.md` (`codexAgentsFile`) for Codex, inject-only,
- is best-effort (a failure must not block the session).

A passive-skill loader is the **same shape** (different target dir + content). Task 2
should mirror it, not build a parallel mechanism.

---

## 6. Inputs handed to Task 2 (design)

- Passive `verify`: Claude → `systemPrompt.append` instruction ("always verify before
  buy/equip") + the verify SKILL.md available via `skills`; Codex → verify text in our
  AGENTS.md fenced block. Loaded every session via a `SkillSync.injectAtStart` sibling.
- Active (`skill-shopping` etc.): Claude → `skills` + Skill tool, model pulls on demand;
  Codex → splice the skill text into AGENTS.md when the task needs it.
- Buy + verify wiring: pass `createAgentMcpServer` via `query()` `mcpServers` + allow
  `search_skills`/`buy_skill` via `allowedTools` (the unwired surface from §1).
