stop flagging lets stsr making
# AgentNet — Claudex "Team Mode" (multi-brain fan-out)

> **Status: design / brainstorm-locked — no source changes yet.** The product where
> AgentNet's soul (multi-brain teamwork) becomes a visible feature: a lead brain
> (Claude) fans out parallel worker brains (Codex) on one user wish, and the user
> *watches the team work*.
> Maps onto the runtime that already exists — [`../packages/core/src/runtime/spawn.ts`](../packages/core/src/runtime/spawn.ts)
> and [`contract.ts`](../packages/core/src/runtime/contract.ts) — no new orchestrator.

---

## 0. Thesis — the one idea

AgentNet is the only place **two rival AI families work as one team**. Everyone else
is locked to one vendor. Claudex makes that teamwork *visible and felt*:

> **One wish. A team of rival AIs works on it — at the same time — and you watch
> them do it.** No code, no vendor lock.

We are NOT building "Claude can call Codex." That's plumbing. We're building the
**war-room feeling** for a non-coder: a team shows up to grant one wish.

### Locked product decisions (brainstorm)

| Axis | Decision | Why |
|---|---|---|
| Soul | **Multi-brain teamwork** | The orchestration IS the product, not the marketplace. |
| First user | **Non-coders** | OpenClaw-style skill users. Team hidden behind one intent. |
| Shape | **Parallel fan-out** | Claude commands N Codex workers at once. |
| What we sell | **Speed — a team, not one bot** | Non-coders *feel* the team; speed is visceral. |
| Face | **Live team cards** | The parallelism must be visible — the cards ARE the speed pitch. |
| On-chain | **Later** | Ship the mode locally first, mint workflows after. |

---

## 1. The grand flow

```mermaid
flowchart TB
    U["🙋 User — one wish (plain text)"] --> LEAD
    subgraph LEAD["🧠 Claude — lead brain"]
        SPLIT["split wish → N tasks<br/>(free-picks 1–4)"]
        MERGE["merge worker results<br/>resolve scratch conflicts"]
    end
    SPLIT -->|spawn_codex_subagents(tasks[])| FAN
    subgraph FAN["🧬 Codex workers — parallel, ephemeral, scratch cwd"]
        direction LR
        W1["worker #1"]:::w
        W2["worker #2"]:::w
        W3["worker #3"]:::w
    end
    W1 --> MERGE
    W2 --> MERGE
    W3 --> MERGE
    MERGE --> APPR["📝 ONE plain-language approval<br/>'create 2 files, edit app.js — allow?'"]
    APPR --> OUT["✅ result + trust badge<br/>'built by a team of rival AIs'"]

    FAN -. live onMessage stream .-> CARDS["🪟 War-room: live team cards"]
    classDef w fill:#1b2,stroke:#093,color:#fff;
```

The whole loop reuses `AgentRuntime.startSession` per worker. The "orchestration"
is just **Claude deciding to call one tool** — no parallel control plane.

---

## 2. The one tool (fan-out built in)

Exposed to Claude via [`mcp-stdio.ts`](../packages/core/src/mcp-stdio.ts) — the Claude
SDK already accepts custom MCP tools.

```ts
spawn_codex_subagents(tasks: { goal: string; cwd?: string; model?: string }[])
  → { results: { goal: string; output: string; filesChanged: string[] }[] }
```

- Body = `Promise.all(tasks.map(runOne))`. One call = N parallel coders.
- Single-subagent is just `tasks.length === 1`. **No second tool.**
  `// ponytail: one tool, array of size 1 is the "single subagent" case.`
- `runOne(t)` = `startSession({ cli:"codex", ephemeral:true, cwd:scratch, approval:gated })`
  → `send(t.goal)` → buffer `onMessage` → resolve on `onTurnEnd` → `stop()`. ~60 lines.

### Depth guard
Worker sessions do **not** get `spawn_codex_subagents` (omit the tool when spawning).
No recursion. Depth cap = 1. `// ponytail: cap 1, deepen only if a real workflow needs it.`

### Worker count
Claude free-picks 1–4 tasks from the wish. Start dumb, tune later.
`// ponytail: cap 4, raise when a real job needs it.`

---

## 3. Approvals — non-coder model (ONE plain decision)

A non-coder **cannot** judge "allow codex #2 to run `git apply`?" — and N of those at
once = panic. So for this user:

- **No per-worker approval prompts.** Workers run sandboxed, writing to an **ephemeral
  scratch cwd**, auto-approving their own actions.
- **One approval at merge time**, in human words, authored by Claude:
  > "The team wants to: create `auth.js`, `auth.test.js`, edit `app.js`. Allow?"
  User taps once. Only the **merged diff** ever faces the user.
  `// ponytail: subagents write to scratch, only the merged diff faces the user.`

> This intentionally overrides the earlier "bubble writes inline" idea — that's the
> **power-dev** surface (inline per-call bubbles, reuse parent `ApprovalChannel`).
> Same engine, different surface. Non-coder = one plain summary; dev = inline bubbles.

---

## 4. War-room view — the product's face

The speed sell is *visual*. Hide the team and you hide the product.

- Each worker's `onMessage` → its **own card**, routed by a new `parentToolId` +
  `agentLabel` on `ChatMessage` (already per-message `cli` field exists).
- Card lifecycle: **forming → working (live bar) → done**. Live bars come from the
  partial-message stream the runtime already emits (no new streaming work).
- Lives in [`surfaces/webview/src/state/store.tsx`](../surfaces/webview/src/state/store.tsx)
  — nest worker cards as a collapsible group under Claude's tool call:
  "🧬 3 Codex workers running".

Minimal contract change: add `parentToolId?: string` and `agentLabel?: string` to
`ChatMessage` in [`contract.ts`](../packages/core/src/runtime/contract.ts). Both optional,
back-compat.

---

## 5. Trust badge (cheap now, real later)

Result carries "built by a team of rival AIs." **Now** = just truthful labelling
(N families ran it). **Later** = real cross-check consensus + on-chain provenance
(see §7). Don't build consensus yet — the label alone is the differentiator no
single-vendor agent can print.

---

## 6. Build order (each step shippable alone)

1. **`runOne` + tool, sequential** in `mcp-stdio.ts` — prove Claude → Codex round-trip.
2. **Gated scratch sandbox** — workers write to ephemeral cwd, auto-approve internally.
3. **`Promise.all` + `agentLabel`** — true parallel fan-out, tagged per worker.
4. **War-room cards** in `store.tsx` — live forming/working/done.
5. **One plain-language merge approval** — Claude summarizes the merged diff.
6. **Trust badge** on result.
7. *(later)* transcript → workflow NFT (verified-work + `nft/` primitives).

Steps 1–2 = working single-worker Claudex. 3–4 = the visible team. 5–6 = non-coder-safe.

---

## 7. Open threads (next session, not now)

- **Split heuristic** — how Claude decides N + the task split. Start free-pick, tune.
- **Scratch merge conflicts** — two workers touch the same file. Claude resolves in the
  merge step; needs a defined scratch layout (per-worker subdir under one temp root).
- **On-chain mint** — Claudex run = a graph of brains. Mint the graph as a workflow NFT
  buyers can fork and re-run. Hooks into existing verified-work marker + `nft/workflow.ts`.
- **Power-dev surface** — inline per-worker approval bubbles (the overridden §3 path).
- **Real consensus** — two families same task, surface disagreement, upgrade trust badge.
```
