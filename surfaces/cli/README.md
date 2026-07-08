# AgentNet CLI

A playful, wallet-synced terminal for claude/codex — a standalone surface over
`@iqlabs-official/agent-sdk` (the same core the VSCode surface uses). Your wallet signs,
the core runs the agent and encrypts every session, the CLI just renders.

```
   ██╗  ██████╗
   ██║ ██╔═══██╗   AgentNet · the agent layer · iqlabs
   ╚═╝  ╚══▀▀═╝
```

## Run

```bash
pnpm --filter agentnet-cli dev        # dev (tsx, from source)
pnpm --filter agentnet-cli build      # bundle → dist/cli.js (bin: agentnet)
node dist/cli.js                      # run the built bin
```

Needs a real terminal (interactive keyboard input). Piped/redirected runs exit with a
hint — use `agentnet doctor` for a non-interactive check.

## Commands & flags

```
agentnet                     launch the TUI (first run walks you through setup, ONCE)
agentnet -c, --continue      resume your most recent session
agentnet resume <id>         boot straight into a saved session
agentnet doctor              claude/codex install + login report (non-interactive)

--cli claude|codex           which engine to start on (default: last used)
--cwd <path>                 working directory for the agent (default: cwd)
--keypair <path>             Solana keypair file (default: ~/.config/solana/id.json)
--model <model>              model to use
--yolo                       auto-approve all tool use (skip prompts)
--calm                       disable animations (also honors NO_COLOR / non-TTY)
```

Setup runs **once** — a marker in `~/.agentnet/cli.json` (plus your last engine/model/session)
means later launches go straight to chat. `Esc` cancels a running turn. `↑/↓` in an empty
composer recalls prior messages. The transcript uses Ink `<Static>`, so the live animations
never repaint scrollback (no flicker/lag on long sessions).

## Composer

The input box is full-featured:
- **Multi-line** — paste with newlines inserts them; `\` then `↵` adds a newline; `↵` sends.
- **Slash menu** — type `/` → filtered command dropdown (`↑/↓` move, `⇥`/`↵` complete, `esc` hide).
- **@-file mentions** — type `@query` → fuzzy project-file picker; `⇥`/`↵` inserts the path.
- Real cursor (`←/→` edit anywhere in the buffer).

## In-chat slash commands

```
/new                  start a fresh session
/sessions  (/ls)      pick a session to resume or delete (↑/↓ · ↵ · d · esc)
/resume <id-prefix>   resume by id prefix
/more                 load older history (scroll-back, prepends)
/compact              compact the conversation context (passed through to the engine)
/clear                clear the on-screen transcript (session kept)
/copy                 copy the last reply to the clipboard
/models               pick a model from a menu (or /model <name> to set directly)
/engine claude|codex  switch engine — the current session CARRIES over (cross-CLI resume)
/wallet               show your wallet address
/storage              view/change where sessions are saved (connect or reconnect cloud)
/iq                   a random IQ fact (+ Iggy spins)
/dance                Iggy dances
/quit  (/q)           leave

!<cmd>                run a shell command locally in the session cwd (scratch shell)
```

Editing: `←/→` move, `Ctrl+A/E` line start/end, `Ctrl+W` delete word, `Ctrl+U/K` kill to
start/end, `↑/↓` recall prior messages, `\`+`↵` newline, `Esc` cancels a running turn.
`--calm` is remembered once set.

## Rich rendering

- **Token streaming** — claude replies stream in token-by-token (real deltas, opt-in via the
  core's `stream` flag; see below). Settles into formatted markdown when the turn ends.
- **Markdown** — headings, **bold**/*italic*/`code`, lists, blockquotes, fenced code (syntax-
  highlighted) in assistant replies.
- **Tool cards** — bash/edit/write/read as tinted cards with real colored diffs.
- **Todos** — `TodoWrite` renders as a live checklist panel.
- **Context meter** — `ctx ~NN%` in the status line (approximate, from transcript size).

## The delight system

Iggy (the mascot) reacts to state; the IQ banner sweeps a gradient on launch; assistant
replies type out; tool actions render as tinted cards with real diffs; finished turns get
a one-line sparkle (confetti on a test pass). All of it is gated by a single
`DelightProvider` and **turns off cleanly** under `--calm`, `NO_COLOR`, or a non-TTY pipe —
and animation never alters real output (tool stdout, diffs, errors are always plain/exact).

## Token streaming (real, opt-in, both engines)

The CLI passes `stream: true` to `startSession`. The core then emits `partial:true` assistant
messages (rendered live, **never persisted**) followed by one `partial:false` final (the full
text, which IS written to the encrypted log).

- **claude** — `includePartialMessages` on; the core accumulates the text deltas into a
  running snapshot before emitting.
- **codex** — the SDK has no delta event, but `item.updated` re-emits the agent_message with
  its full text-so-far; the core surfaces that.

Both therefore emit "full text so far", so `useChat` simply **replaces** the live line each
update. Surfaces that don't opt in (vscode) keep whole-turn behavior — fully gated.

## Context meter (real)

`ctx NN%` is the **real** context-window occupancy: the engine reports per-turn token usage
(`SessionHandle.onUsage`) — claude's `result.usage` (input + cache), codex's `turn.completed`
usage (input + cached). Before the first turn reports, it shows an estimate as `ctx ~NN%`
(chars/4); the `~` drops once real usage arrives. This is **context fill, not plan/billing
limits** — the CLI rides your installed `claude`/`codex` login (subscription or API key) and
cannot see your account quota.

## How it maps to the core

`bootstrap.ts` sequences the same calls the VSCode surface makes (`localWallet` →
`detectCli` → `connect`). `useChat` mirrors `extension.ts`'s `openChat()` loop for a single
active chat. `InkApprovalChannel` implements the core's `ApprovalChannel` seam. No core code
is modified — the CLI is a true peer of the VSCode surface and shares its encrypted session
log (open the same session in either).
