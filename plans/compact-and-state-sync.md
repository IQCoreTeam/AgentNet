# Compact / Summary & Session-State Sync (cross-CLI, extensible)

> Sibling: [`actions-and-adapters.md`](actions-and-adapters.md) §5b (CLI runtime adapter),
> [`offchain-session-sync.md`](offchain-session-sync.md) (session/encryption model).
> This doc owns: how **state-changing operations other than plain turns** (compact,
> summaries, checkpoints) stay compatible across CLIs — and how to add a new CLI cheaply.

---

## 0. The problem (why plain turns aren't enough)

Cross-CLI resume today moves **plain conversation turns** (user/assistant) between
claude and codex — verified working (a session born in claude resumes in codex and
vice versa). But a real session also accumulates **state that each CLI produces its
OWN way**:

| Operation | claude | codex | other (future) |
|---|---|---|---|
| **compact** (shrink a long context) | writes a summary back into its jsonl | has its own compaction | ? |
| running **summary** / memory | per-CLI | per-CLI | ? |
| checkpoints / forks | per-CLI | per-CLI | ? |

If we sync only raw turns, a `/compact` done in claude is invisible to codex (and vice
versa). zo's point: **everything that touches session data must be cross-compatible**,
and because **more platforms will be added**, the design must make adding one cheap —
without making the simple plain-turn path complex.

---

## 1. Design principle — one neutral kind, per-CLI converters

Keep the **canonical log the single source of truth** and represent each
state-operation as a **neutral record** there. Each CLI only needs a thin converter
in BOTH directions (capture + inject) — exactly the pattern already used for turns:

```
              capture (native → canonical)        inject (canonical → native)
   claude  ──────────────────────────────▶  canonical  ◀──────────────────────────────  claude
   codex   ──────────────────────────────▶   log on    ◀──────────────────────────────  codex
   <new>   ──────────────────────────────▶   drive     ◀──────────────────────────────  <new>
```

- **Plain turns stay exactly as they are** — `ChatMessage{role:"user"|"assistant"}`.
  The simple path does NOT get more complex.
- **A compaction/summary becomes one extra neutral record**, not a special pipeline.
- Adding a CLI = write its two converter functions (already true for turns); nothing
  in the core changes. This is the "easy to modify / easy to add a platform" zo asked for.

---

## 2. The neutral record — extend `ChatMessage`, don't fork the schema

`ChatMessage.role` is today `"user" | "assistant" | "thinking" | "tool"`. Add ONE
member:

```ts
role: "user" | "assistant" | "thinking" | "tool" | "summary"
```

A `summary` record means **"from here back, this text REPLACES the prior turns for
context purposes"** (that's what every compaction is, regardless of CLI). Optional
metadata rides in fields we already allow to be absent — no breaking change:

```jsonc
// canonical summary record (one line in the encrypted log, same as any message)
{ "role": "summary",
  "text": "<the compacted summary text>",
  "ts": 1700000000,
  "replacesUpTo": 1699999000   // optional: ts of the last turn this summary subsumes
}
```

Why this shape:
- It is **CLI-neutral** — neither "claude summary" nor "codex summary", just "summary".
  (Same rule as the rest of the log: no platform stamped into the content — see the
  existing canonical/`CanonicalSession` contract.)
- It is **additive** — old readers that don't know `summary` simply skip a role they
  don't render; nothing else breaks.
- `replacesUpTo` lets inject decide what to drop when rebuilding native history.

---

## 3. Per-CLI behavior (capture + inject), kept thin

Each CLI's converter pair gains a small amount of logic. NOTHING else changes.

### Capture (native → canonical) — `convert/<cli>.ts`
- Detect that CLI's compaction event in its stream/jsonl and emit one
  `{role:"summary", text, replacesUpTo}` record. (claude and codex each have their own
  signal; the converter is the ONLY place that knows it.)

### Inject (canonical → native) — `inject/<cli>.ts`
When rebuilding native history for resume, a `summary` record is handled per target:
- **If the target CLI understands a native summary slot**, write it there.
- **Otherwise (safe default), fold it into context as a leading assistant/system note**
  ("Summary of earlier conversation: …") and DROP the turns it `replacesUpTo`. This
  guarantees the receiving CLI still gets the compacted context even if it has no native
  compaction concept — which is also the right behavior for a brand-new platform with
  zero special support.

> Default fold-in means a new CLI works on day one with NO summary-specific code: it
> just receives the summary as text. Native-summary support is an optional upgrade per CLI.

---

## 4. Adding a new platform (the cheap path)

To add CLI **X**:
1. `convert/X.ts` — native line → `ChatMessage` (turns; emit `summary` if X compacts).
2. `inject/X.ts` — `ChatMessage[]` → X's native session files (turns; fold summaries in).
3. register X in spawn + the cli union type.

No core/schema/storage change. The summary mechanism above is automatically available
to X via the safe fold-in default; native-summary handling is opt-in later.

---

## 5. Build order (do NOT do this yet)

This is an **open design**, deliberately deferred. The plain-turn cross-CLI resume is
done and verified; this layer sits on top.

- [ ] Confirm the REAL compaction signal in each CLI's output (claude jsonl summary
      line shape; codex compaction event) — needs empirical capture, like we did for
      the resume jsonl formats. Don't hardcode a shape until observed.
- [ ] Add `"summary"` to `ChatMessage.role` (contract.ts) + sessionLog handling
      (it already stores arbitrary message records, so likely a no-op).
- [ ] Capture: emit `summary` in `convert/{claude,codex}.ts`.
- [ ] Inject: fold-in default in `inject/{claude,codex}.ts`; native slot where supported.
- [ ] Verify cross-CLI: compact in claude → resume in codex still has the compacted context.

## 6. Open questions
- claude's exact on-disk summary representation (no sample captured yet — observe first).
- codex's compaction event name/shape (same).
- Should `summary` also collapse the canonical log itself (save space), or only affect
  inject? Lean: keep full canonical (it's the source of truth / audit), summary only
  changes what inject rebuilds.
- Forks/checkpoints: same neutral-record approach, later, once compact is proven.
