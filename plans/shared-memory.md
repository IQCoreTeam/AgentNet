# Shared agent memory over Google Drive (issue #18)

One shared, wallet-owned memory that syncs across runtimes (Claude / Codex) and
devices via the existing Google-Drive `StorageAdapter` — the memory analog of
cross-CLI session resume. Shape: **per-runtime memory file ⇄ canonical store ⇄
Drive**, mirroring `runtime/convert` + `runtime/inject` + `account/store.ts`.

Branch: `feat/shared-memory`, cut from `main` (where the storage + capture/inject
layers already live; `feat/cross-cli-resume-and-storage` is already merged).

---

## Task 1 — Research: real on-disk memory of each runtime

Parsed from a live install on this machine (not from docs). The point is to design
a canonical form that maps losslessly to whichever of these is the *richer*
structure (Claude) and renders down to the *flatter* one (Codex).

### Claude — structured, multi-file, with a frontmatter + index convention

Three distinct memory surfaces:

| Surface | Path | Format | Loaded into session |
|---|---|---|---|
| Global instructions | `~/.claude/CLAUDE.md` | plain markdown | concatenated into system context every session |
| Project instructions | `<repo>/CLAUDE.md` | plain markdown (committed to repo) | concatenated when cwd is in that repo |
| **Auto-memory** | `~/.claude/projects/<encoded-cwd>/memory/` | **frontmatter `.md` files + `MEMORY.md` index** | index loaded every session; individual files *recalled on relevance* (surfaced inside `<system-reminder>`) |

The auto-memory dir is the interesting one (the others are just flat prose). Layout:

- One `.md` file **per fact**, e.g. `git-sdk-evm-port.md`, with YAML frontmatter:
  ```markdown
  ---
  name: git-sdk-evm-port
  description: Port on-chain Git SDK to EVM — Phases 1-4 done (branch evm-port)…
  metadata:
    node_type: memory
    type: project            # user | feedback | project | reference
    originSessionId: 62c2f9f5-04c4-4cdf-8459-28e0304a4771
  ---

  <markdown body — the fact. Links other memories via [[other-name]].>
  ```
- `MEMORY.md` — the index, **one line per memory**, loaded into context each session:
  ```markdown
  # Memory index
  - [git-sdk-evm-port](git-sdk-evm-port.md) — port on-chain Git SDK to EVM: Phase 5 next
  ```
- Cross-links between records use `[[name]]` (matches another record's `name:` slug).
- `<encoded-cwd>` = the project path with `/` → `-` (e.g.
  `-Users-parthagrawal99-Desktop-iq-labs`), so memory is **scoped per project dir**.

Field semantics worth preserving: `name` (stable slug / filename), `description`
(one-line, used for recall ranking + the index line), `metadata.type`
(user / feedback / project / reference), `metadata.originSessionId` (provenance).

### Codex — flat, hierarchical, single primitive (`AGENTS.md`)

OpenAI Codex's documented memory primitive is **`AGENTS.md`**: plain markdown, **no
frontmatter, no per-record structure, no index**. It is hierarchical and *merged*
at session start (global → repo → cwd):

| Path | Role |
|---|---|
| `~/.codex/AGENTS.md` | global, all projects |
| `<repo-root>/AGENTS.md` | per-repo (committed; AgentNet ships one at `surfaces/android/guest/AGENTS.md`) |
| `<cwd>/AGENTS.md` | most specific |

`~/.codex/config.toml` is config (notify hooks, `[projects."…"]` trust), **not**
memory. Sessions are jsonl under `~/.codex/sessions/YYYY/MM/DD/` — already handled
by `runtime/inject/codex.ts`.

> ⚠️ This particular machine also has a non-standard `~/.codex/memories/` dir (its
> own `MEMORY.md` + `raw_memories.md` + `rollout_summaries/`) from an extended
> Codex build. That is **not** the portable Codex primitive and should NOT be the
> canonical target — AgentNet spawns stock `codex`, whose memory is `AGENTS.md`.

### Codex live probes (codex-cli 0.139.0, model gpt-5.5) — verified, not assumed

Ran `codex exec` against a temp repo with a known codeword in `AGENTS.md`:

1. **Inject works** — AGENTS.md is loaded at session start; codex recalled the
   planted codeword. So `canonical → AGENTS.md` is a working injection path.
2. **Merge = concatenation** — with both `~/.codex/AGENTS.md` (global) and
   `<cwd>/AGENTS.md` (repo) present, codex saw **both** values (not override).
   → our global block coexists with any repo-authored `AGENTS.md`.
3. **Stock codex NEVER self-writes memory** — after a turn, AGENTS.md hash was
   unchanged, no global `~/.codex/AGENTS.md` was created, no memory file written.
   Only a session `rollout-*.jsonl` was produced (already handled by
   `runtime/convert/codex.ts`).
4. CLI note: `codex exec` reads stdin even when a prompt arg is given — pass
   `< /dev/null` to avoid a hang; `--skip-git-repo-check` lets it run outside a repo.

**Design impact — the round-trip is ASYMMETRIC:**
- **Claude** = read **and** write (it owns discrete frontmatter records → the
  canonical *writer/source of truth*).
- **Codex** = **inject-only / read** (stock codex never mutates memory). So there is
  **no Codex→canonical capture to build** for stock codex. We only render
  `canonical → ~/.codex/AGENTS.md` (a fenced `<!-- agentnet:memory -->` block so we
  never clobber human content), refreshed at session start.

This collapses Task 3: capture-back logic is needed for the **Claude** side only
(watch its memory dir → canonical → Drive); the Codex side is a one-way inject.
**Scope (decided): per-wallet + project.** Storage key = `mem/<wallet>/<projectId>`
where `projectId` is the project cwd (Claude already scopes per project via
`projects/<encoded-cwd>/memory/`; the same cwd identifies the Codex repo). So the
Codex fenced block is written to the **repo `<cwd>/AGENTS.md`** (not global) — its
concatenation behavior keeps any human content in that file intact. One canonical
blob per (wallet, project), mapping 1:1 to Claude's per-project memory dir.

### Comparison

| | Claude auto-memory | Codex `AGENTS.md` |
|---|---|---|
| Unit | one frontmatter `.md` **per fact** | sections (`##`) inside **one** file |
| Metadata | `name`, `description`, `type`, origin (YAML) | none (heading text only) |
| Index | explicit `MEMORY.md` | none (the file *is* the whole memory) |
| Scope | per project dir (`projects/<encoded-cwd>/memory/`) | global + repo + cwd, merged |
| Cross-links | `[[name]]` | none |
| Load | index always; records on relevance | whole merged file, always |
| Write granularity | add/edit/delete a single record file | edit the one markdown file |

**Design consequence:** Claude is the *lossless superset*. The canonical form must
carry per-record metadata (name/description/type/links/origin). Mapping:

- **canonical → Claude**: one `.md` per record (fields → frontmatter) + regenerate
  `MEMORY.md` from each record's `description`. Direct.
- **canonical → Codex**: render every record as a `## <name>` section (description
  as the lead line, body below) into a single managed `AGENTS.md` block.
- **Codex → canonical (capture)**: parse `##` sections back to records keyed by
  heading slug; this is **lossy** (no frontmatter), so merge onto existing
  canonical metadata rather than overwriting `type`/`origin`. Use a fenced marker
  region (e.g. `<!-- agentnet:memory:start -->…<!-- end -->`) so we only own our
  block and never clobber human-authored `AGENTS.md` content.

---

## Task 2 — Design: one canonical memory form (next)

Mirror `CanonicalSession` in
[contract.ts](../packages/core/src/runtime/contract.ts). Sketch:

```ts
interface MemoryRecord {
  name: string;          // stable slug = Claude filename / Codex heading slug
  description: string;    // one-line; Claude index line + Codex section lead
  body: string;           // markdown
  type: "user" | "feedback" | "project" | "reference";
  links?: string[];       // [[name]] cross-refs
  originSessionId?: string;
  updatedAt: number;
}
interface CanonicalMemory { version: 1; records: MemoryRecord[]; }
```

- Persist via `StorageAdapter` (reuse `gdrive.ts`), encrypted to the wallet with the
  same crypto path `account/store.ts` uses, keyed per wallet/agent (single small
  blob — no paging needed, unlike sessions).
- Inject at session start (canonical → that runtime's files); capture writes back
  (runtime files → canonical → Drive), wired into
  [runtime/index.ts](../packages/core/src/runtime/index.ts) beside the session path.

## Task 3 — Implement (after design agreed)

`packages/core/src/memory/`:
- `convert/{claude,codex}.ts` — native memory files ⇄ `CanonicalMemory`.
- `store.ts` — encrypted canonical memory over `StorageAdapter` (model on
  `account/store.ts`, single-blob).
- wire inject-at-start + capture-on-write into `runtime/index.ts`.

## Verification
- Round-trip test (model on `packages/core/test/test-runtime.ts`): write a fact in
  Claude format → canonical → (Drive/local stub) → render Codex `AGENTS.md` → parse
  back → assert the fact + its metadata survive both directions.
- E2E: learn a fact in a Claude session, start a Codex session for the same wallet,
  confirm it appears in the injected `AGENTS.md` block.
