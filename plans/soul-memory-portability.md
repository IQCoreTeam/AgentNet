# Soul & memory portability — how MEMORY.md / SOUL.md-class files follow the wallet to foreign runtimes

> **Status: IDEATION.** Follow-up to issue #84 (portable agent identity) and its code-level
> comment. The marketplace band is now reachable from foreign hosts (the stdio server runs
> full-mode via `AGENTNET_MCP_READONLY=0`, and bought skills install into `~/.hermes/skills/`
> and `~/.openclaw/skills/`). This doc ideates the NEXT band to detach: the **identity/memory
> files** — so an OpenClaw, Hermes, or Eliza agent that signs as the wallet doesn't just get
> the skills, it gets the *same self*.
>
> Track 1 = build the soul/memory file rail (this doc). Track 2 = per-host login QA
> (`plans/qa/external-hosts-qa.md`).

## 1. What already exists (don't reinvent)

The memory rail is live for our two engines (`plans/shared-memory.md`, `packages/core/src/memory/`):

- **Canonical:** `CanonicalMemory { version, records: MemoryRecord[] }`, one encrypted blob per
  (wallet, project) on the user's vault, key = `deriveSessionKey(wallet)`.
- **Converters:** Claude ⇄ per-project frontmatter `.md` files + generated `MEMORY.md` index;
  Codex ← fenced `<!-- agentnet:memory -->` block in `AGENTS.md` (inject-only — stock Codex
  never writes memory).
- **Merge:** newest `updatedAt` wins per record name; disjoint records kept.

What does NOT exist: any notion of a **persona/identity file** (a "soul"), and any memory
converter for a runtime we don't spawn ourselves.

## 2. Native file inventory per runtime

| Runtime | Persona ("soul") | Memory (facts) | Direction we can support |
|---|---|---|---|
| Claude Code | `CLAUDE.md` (+ output styles) | per-project `memory/*.md` + `MEMORY.md` index | inject + capture (done) |
| Codex | `AGENTS.md` (same file doubles as both) | `AGENTS.md` fenced block | inject only (done) |
| OpenClaw | workspace `SOUL.md` (+ `IDENTITY.md`, `USER.md`) | workspace `MEMORY.md` (long-term) + `memories/YYYY-MM-DD.md` (daily) | inject + capture (plugin `after_agent_turn` hook, clawbal precedent) |
| Hermes | system-prompt / persona config under `~/.hermes/` | `~/.hermes/` memory store (own format; no session-end plugin hook) | inject + explicit-tool capture (agent must call a save tool — no hook exists) |
| Eliza | characterfile JSON (`name`, `bio`, `lore`, `topics`, `style.*`, `adjectives`) | runtime DB (per-instance memories) + `knowledge` entries | inject (generate character.json); capture is v2+ (DB extraction) |

Two observations fall out of the table:

1. **Persona and memory are different rails.** Persona is *per-wallet, global* (the agent is
   the same self in every project); memory is *per-project* (already scoped that way). They
   need different storage keys and different merge semantics.
2. **Every runtime's persona shape is markdown-or-JSON-renderable from one master.** OpenClaw
   literally calls it `SOUL.md`. Eliza's characterfile is the only structured one, and its
   fields map cleanly onto markdown sections.

## 3. The soul rail — three candidate shapes

**(A) Structured canonical schema** (`CanonicalSoul { name, bio[], style[], lore[], ... }`),
per-runtime renderers generate every file.
*Pro:* lossless for Eliza; queryable. *Con:* markdown runtimes (OpenClaw/Claude) force users'
free-form persona prose into our schema — high friction, lossy in the direction people
actually write.

**(B) Opaque per-runtime sync** — each runtime's native files stored as-is in the vault, no
translation.
*Pro:* zero loss, zero converter work. *Con:* no cross-runtime portability at all — an
OpenClaw soul never reaches Eliza. That fails the #84 vision ("the brain changes; identity
moves as one").

**(C) Markdown master + section-aware renderers** — recommended.
The canonical soul IS a `SOUL.md`: free-form markdown with a small set of *recognized*
sections (`# Name`, `## Bio`, `## Style`, `## Lore`, `## Boundaries`) plus any number of
unrecognized ones (preserved verbatim, round-tripped untouched).
- OpenClaw: write the master through (near-identity mapping — their convention is ours).
- Claude: append/replace a fenced `<!-- agentnet:soul -->` block in `CLAUDE.md` (same
  mechanism as Codex memory inject — proven idempotent).
- Codex: same fenced block in `AGENTS.md`, above the memory block.
- Hermes: render to its persona/system-prompt config slot.
- Eliza: map recognized sections → characterfile fields (`## Bio` bullets → `bio[]`,
  `## Style` → `style.all[]`, `## Lore` → `lore[]`); unrecognized sections concatenate into
  `lore[]` so nothing silently drops.

Storage: one encrypted blob `soul__<wallet>` (global — NOT per-project, unlike
`memory__<projectId>`), same `deriveSessionKey` crypto, same `StorageAdapter`/mirror stack.
Merge: the soul is one document, so per-record merge doesn't apply — last-writer-wins with
`lastWriter{device,ts}` stamped in the blob header (pillar-3 visibility; soft lease later if
multi-driver editing ever hurts).

## 4. Memory rail extension to foreign runtimes

Cheapest first, per host:

- **OpenClaw (v1):** render canonical records into workspace `MEMORY.md` as a fenced
  `<!-- agentnet:memory -->` block (the Codex converter generalizes almost verbatim).
  Capture: parse records back out of `MEMORY.md` + treat `memories/*.md` daily notes as
  capture *sources* (new records, `type: project`, `originSessionId` = date). The native
  plugin's `after_agent_turn` hook makes capture automatic — MCP alone can't do that.
- **Hermes (v1):** inject-only, same fenced block in whatever markdown context file Hermes
  loads (verify exact path at build time). Capture requires an explicit tool call (below) —
  Hermes has no session-end plugin hook.
- **Eliza (v1):** render records into `knowledge` entries at character-generation time.
  Capture deferred.

## 5. The self-serve unlock: vault tools on the MCP server (recommended v1 core)

Per-host file converters are the polish, not the core. The core move is exposing the rails as
**MCP tools on the same stdio server** the hosts already spawn:

```
soul_get()                → decrypted SOUL.md master
soul_set(text)            → encrypt + save (stamps lastWriter)
memory_list(project?)     → records (name, description, type)
memory_save(record)       → upsert one MemoryRecord (updatedAt merge)
```

Then ANY MCP-speaking runtime can pull its own soul/memory at session start and push updates
when it learns something — via a bundled "agentnet-identity" skill that tells the agent when
to call these — **without us writing a converter for it first**. Converters (§3C, §4) become
progressive enhancement for the hosts we care most about, not a gate. This also answers
Hermes' missing session-end hook: the agent is instructed (by the skill) to `memory_save`
as it goes, not at teardown.

Spend-scope note: these tools read/write the user's OWN vault, nothing on-chain — they belong
in the write-tool tier (full mode only), not `PROMPT_BEFORE_USE`.

## 6. Proposed build order (Track 1)

1. `soul` module: blob store (`soul__<wallet>`), SOUL.md section parser, lastWriter header.
2. Vault tools `soul_get` / `soul_set` / `memory_list` / `memory_save` on the stdio server
   (full mode), + a bundled skill that teaches a foreign agent the inject/capture rhythm.
3. OpenClaw converters (SOUL.md pass-through + MEMORY.md fenced block) — highest-fidelity
   host, live-watch, plugin hook available.
4. Eliza characterfile renderer (`soul → character.json`).
5. Hermes context-file inject (after verifying its exact markdown context path).
6. Claude/Codex soul inject (fenced block) so OUR engines read the same soul — dogfood.

## 7. Open questions

- **SOUL.md recognized-section set** — is `Name/Bio/Style/Lore/Boundaries` enough, or does
  Eliza's `topics`/`adjectives` deserve first-class sections? (Leaning: start with 5;
  unrecognized sections already survive round-trip.)
- **Soul vs safety** — `soul_set` lets any full-mode host rewrite the persona. Fine for
  one-person-one-wallet (the premise), but worth a size cap + a visible `lastWriter` so a
  rogue skill overwriting your soul is at least attributable.
- **Per-project soul overrides** — out of scope v1 (soul is global); revisit if a real user
  wants a work-persona vs home-persona split.
- **Eliza capture** — reading Eliza's DB memories back into canonical is real work; only
  worth it if Eliza usage materializes in QA (Track 2 will tell us).

**Related:** #84 · `plans/shared-memory.md` · `plans/offchain-session-sync.md` ·
`plans/actions-and-adapters.md` §5b · `plans/qa/external-hosts-qa.md` (Track 2)
