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

### 1b. The leaked harness — primary-source confirmation (issue's literal ask)

Verified against leaked Claude system prompts (jujumilk3/leaked-system-prompts:
`anthropic-claude-opus-4.6_20260206.md`, `-4.7`, `-4.5-full`). The harness implements the
same two-layer model, and — crucially — shows *exactly* how Anthropic force-runs a passive
skill:

- **Always-on layer** = a `<available_skills>` block in the system prompt. Each entry is a
  `<skill>` with name, description, and the **path to its SKILL.md** (e.g.
  `/mnt/skills/public/docx/SKILL.md`). Skill roots: `/mnt/skills/public/` (built-in),
  `/mnt/skills/user/` (user-uploaded — "attend very closely"), `/mnt/skills/example/`.
- **On-demand layer** = the model calls the `view` tool on a SKILL.md path *before* doing
  the task (progressive disclosure, stated explicitly: "read the documentation … BEFORE
  writing any code").
- **Passive force-load mechanism (the key finding):** an `<additional_skills_reminder>`
  block hard-codes *"ALWAYS call `view` on `/mnt/skills/public/pptx/SKILL.md` before …"* —
  an always-on system-prompt directive that makes a skill run unasked. **This is direct
  evidence that our passive-`verify` design (a `systemPrompt.append` directive: "always run
  verify before buy/equip") is exactly the mechanism Anthropic itself uses.** Note the
  leaked harness (claude.ai computer-use) loads skills from `/mnt/skills`, whereas the
  shipped Claude Code / agent-SDK (§1) loads from `~/.claude/skills` + project
  `.claude/skills` via the `skills` option — same model, different surface.

---

## 2. Hermes (NousResearch/hermes-agent)

> Verified against the primary source — `website/docs/user-guide/features/skills.md` and
> `website/docs/guides/work-with-skills.md` in the repo — not just secondary write-ups.

- **SKILL.md + YAML frontmatter.** Required `name`, `description`; optional `version`,
  `platforms`, and a `metadata.hermes` section (tags, categories, config). Same `---` block
  + markdown body as Claude.
- **Discovery:** scans `~/.hermes/skills/` (primary source of truth, organized by category
  subdirs) plus `skills.external_dirs` in `config.yaml`. Local version wins on name clash.
- **Loading = three-tier progressive disclosure (its OWN mechanism, like Claude — not
  always-on):**
  - **Level 0** `skills_list()` → `[{name, description, category}, …]` (~3k tokens), loaded
    at session start.
  - **Level 1** `skill_view(name)` → full SKILL.md body, only when the agent decides it's
    relevant.
  - **Level 2** `skill_view(name, file_path)` → specific reference files on demand.
  - "Skills don't cost tokens until they're actually used."
- **Activation modes:** built-in skills are **always-on slash commands** (`/skill-name`
  injects the full SKILL.md into the user message alongside the task); Hub skills are
  **on-demand**, installed via `hermes skills install official/<cat>/<skill>`. Per-platform
  enable/disable (CLI / Telegram / Discord) via `hermes skills`.
- **Config/credentials:** skills declaring needs store under `skills.config.*` in
  `config.yaml`; prompted on first load.
- **Cross-agent portability:** follows the open **agentskills.io** standard; skills authored
  for Claude/Cursor/Codex work unmodified, agent-specific frontmatter ignored, body +
  supporting files used as-is.
- **Takeaway for us:** Hermes sits in idiom #2 (discovered-then-pulled, §4) right next to
  Claude — and it *also* has an always-on lane (built-in slash commands). So the same
  canonical `SKILL.md` is portable across Claude + Hermes + Codex/Cursor (extra fields
  tolerated-and-ignored), exactly how `skill-shopping.md` is already written. Its
  slash-command "inject full body into the user message" is a third concrete pattern for
  forcing a passive skill in.

---

## 3. Other runtimes — how each takes `.md` into context

| Runtime | Mechanism | Always-on vs on-demand | Frontmatter / discovery |
|---|---|---|---|
| **Codex CLI 0.139.0** (the version we pin — `@openai/codex-sdk@^0.139.0`) | Reads **`AGENTS.md`** at the session cwd (global + repo concatenated) at session start. **Inject-only** — stock codex never writes memory (verified in [`memory/convert/codex.ts`](../packages/core/src/memory/convert/codex.ts)). `codex --help` on the pinned binary shows **no `skills` subcommand** → no SKILL.md support at our version. | **Always-on only** — whatever is in AGENTS.md is in context every turn; no on-demand pull. | Plain markdown, no frontmatter discovery. We own a fenced `<!-- agentnet:… -->` block. |
| **Codex (newer than 0.139.0)** ⚠️ version-gated | Per developers.openai.com/codex/skills: **does** support SKILL.md — scans `.agents/skills` (cwd→repo root), `$HOME/.agents/skills`, `/etc/codex/skills`, built-ins. | Progressive disclosure: name+description+path always-on (list capped ~8k chars), full body on-demand. | `name`+`description` frontmatter; optional `agents/openai.yaml`. | **Only relevant if AgentNet bumps the codex SDK** — then Codex gains the same SKILL.md path as Claude and the AGENTS.md-only workaround can be dropped. |
| **Cursor** (verified at cursor.com/docs/context/rules) | `.cursor/rules/*.mdc` — YAML frontmatter (`description`, `globs`, `alwaysApply`) + body. **Plain `.md` in `.cursor/rules` is ignored** (no frontmatter); `AGENTS.md` at root is the plain-markdown alternative. Rules apply to Agent/Chat only (not Tab/Inline Edit). | **Four** modes: (1) `alwaysApply:true` = always-on (globs/description ignored); (2) "Apply Intelligently" — `false`+description, agent decides from description; (3) "Apply to Specific Files" — globs, auto-attached when a matching file is in context; (4) "Apply Manually" — `@rule-name` mention only. | YAML frontmatter; per-rule glob targeting. Best practice: keep rules **under 500 lines** (docs give no token figure). |
| **Aider** (verified aider.chat/docs) | `CONVENTIONS.md` — free-form markdown, no frontmatter. Loaded **read-only** into chat via `/read CONVENTIONS.md`, `--read` flag, or the `read:` key in `.aider.conf.yml`; cached if prompt caching on. | **Manual / config-pinned always-on** (once added it stays in context). No discovery, no on-demand pull. | None; plain markdown. Idiom #1. |
| **Claude `CLAUDE.md`** (same runtime as §1, different file) | Project/user `CLAUDE.md` concatenated into the system prompt (loaded when `settingSources` includes `'project'`). | **Always-on**, no discovery — closest analog to Codex AGENTS.md. | No frontmatter; plain instructions. |
| **smolagents** (HF — counter-example) | **No `.md` skill files at all.** Capabilities = Python `Tool` objects (name/description/inputs/output_type) rendered via Jinja2; system prompts = YAML templates (`code_agent.yaml`) loaded from package resources with `importlib.resources`. | n/a — prompt-template + code-object paradigm, not file-discovered skills. | Shows not every framework uses the `.md`-skill model; irrelevant to our two runtimes but bounds the survey. |

### 3b. The portability standard (breadth)

- **agentskills.io** (verified at the canonical site, not a secondary blog) — open SKILL.md
  standard: a skill is a folder with **`SKILL.md` (required, `name`+`description` min)** plus
  optional `scripts/`, `references/`, `assets/`. **Originally developed by Anthropic,
  released as an open standard.** Defines the §4 idiom-#2 pattern explicitly as three stages:
  **Discovery** (startup: only name+description per skill) → **Activation** (read full
  SKILL.md when task matches description) → **Execution** (follow + load bundled files on
  demand). Canonical client list (from the site's showcase) includes: Claude Code, Claude,
  OpenAI Codex, Cursor, VS Code, GitHub Copilot, Gemini CLI, **OpenHands**, **Goose**, Roo
  Code, JetBrains Junie, OpenCode, Amp, Letta, Kiro, Factory, Tabnine, Mistral Vibe, and
  ~30 more. So a plain agentskills.io `SKILL.md` is the maximally-portable authoring format.
- **AGENTS.md** (agents.md) — minimalist sibling standard: a single root `AGENTS.md`,
  **parsed as plain natural-language markdown, no required structure/metadata**; closest
  file to the edit wins; explicit chat prompts override. This is the idiom-#1 lane that
  Codex 0.139.0 and Cline (issue #5033) implement.
- Implication: authoring our skills (`verify`, `skill-shopping`, bought skills) as plain
  agentskills.io `SKILL.md` keeps them portable across every runtime above; the AGENTS.md
  block is the fallback for runtimes (our pinned Codex) without SKILL.md support.

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
  Skill tool for active). Leaked-harness confirmed (§1b).
- **Codex 0.139.0 (pinned)** has *only* idiom #1 (AGENTS.md) — verified no `skills`
  subcommand (§3). So for our Codex, **both** passive and active skills collapse to "text in
  AGENTS.md," and "on-demand" can only mean "splice the active skill's text in before the
  turn that needs it." ⚠️ **Version-gated:** a newer codex (§3, `.agents/skills`) would give
  Codex idiom #2 too, letting us drop the AGENTS.md workaround — design for AGENTS.md now,
  leave the door open for the bump.

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
