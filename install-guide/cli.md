# AgentNet CLI

The terminal surface. Installs from npm:

```bash
npm install -g @iqlabs-official/agentnet-cli

agentnet            # launch the TUI
agentnet doctor     # check claude/codex install + login (non-interactive)
```

Requires Node.js 20+ and at least one engine (`claude` or `codex`) installed and logged
in — see Prerequisites below. Developers running from source: jump to
[Running from source](#running-from-source-contributors).

---

## Prerequisites

### 1. Node

```bash
node -v   # need v20+
```

### 2. Install `claude` CLI and log in

The CLI **drives claude via the `claude` binary**. You need it on PATH and logged in.

```bash
# Install (macOS)
npm install -g @anthropic-ai/claude-code

# Log in
claude login
# or: claude auth login

# Verify
claude --version
claude doctor   # should show "Logged in as ..."
```

### 3. (Optional) Install `codex` CLI for the Codex engine

```bash
npm install -g @openai/codex

codex login      # OpenAI account
codex --version  # verify
```

### 4. Solana keypair (wallet identity)

AgentNet uses a Solana keypair for wallet-derived session encryption. Default path is `~/.config/solana/id.json`.

```bash
# Already have one? Skip.
ls ~/.config/solana/id.json

# Don't have one? Generate:
solana-keygen new --outfile ~/.config/solana/id.json
# OR if you don't have solana CLI:
#   The app will prompt you on first launch and generate one automatically.
```

> The keypair is **local only** — no tokens, no blockchain tx required for the CLI.
> It's only used to derive an encryption key for your session logs.
> If the default path doesn't exist, the CLI generates one there on first launch
> (it never overwrites an existing file).

---

## First launch

```bash
agentnet
```

You'll see:
1. Animated IQ banner
2. Boot checklist (claude ✓ / codex ✓ / wallet ✓)
3. Onboarding screen (first time only — picks storage location)
4. Chat REPL

---

## Running from source (contributors)

Needs pnpm v9+ (the repo is a pnpm workspace). Clone, then from the repo root:

```bash
pnpm install

# Dev mode (tsx, hot-reloads on save):
pnpm dev:cli

# Or build + run the bundled binary:
pnpm build:cli
node surfaces/cli/dist/cli.js
```

The build inlines the workspace core from source — no separate core build step needed.

---

## CLI Flags

| Flag | What it does |
|------|-------------|
| `--cli claude` | Force claude engine (default: last used) |
| `--cli codex` | Force codex engine |
| `--cwd <path>` | Working dir for the agent (default: `process.cwd()`) |
| `--keypair <path>` | Custom Solana keypair file |
| `--model <name>` | Override model (e.g. `claude-opus-4-5`, `gpt-4o`) |
| `-c` / `--continue` | Resume most recent session |
| `--calm` | Disable all animations (persisted — stays off next launch too) |
| `--yolo` | Auto-approve all tool use (no prompts) |

**Subcommands:**

```bash
agentnet doctor              # check claude/codex install + login, no TUI
agentnet resume <sessionId>  # jump straight into a saved session
```

---

## Inside the REPL — Slash Commands

Type `/` to open the slash menu (autocomplete). Available commands:

| Command | Action |
|---------|--------|
| `/new` | New session |
| `/sessions` | Browse + resume saved sessions |
| `/engine claude\|codex` | Switch engine (carries current session) |
| `/model <name>` | Switch model |
| `/models` | Interactive model picker |
| `/compact` | Compact context (tell claude to summarize) |
| `/clear` | Clear visible transcript |
| `/copy` | Copy last assistant reply to clipboard |
| `/help` | Show all commands |
| `/quit` | Exit |
| `/iq` | Easter egg 🧠 |
| `/dance` | Easter egg 💃 |

**Bash passthrough:** prefix with `!`

```
!ls -la
!git status
!npm test
```

**@-file mentions:** type `@` to autocomplete files from cwd → attaches file content to your message.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Shift+Enter` | Newline (multi-line input) |
| `↑` / `↓` | History recall |
| `Ctrl+A` | Go to start of line |
| `Ctrl+E` | Go to end of line |
| `Ctrl+U` | Clear to start |
| `Ctrl+K` | Clear to end |
| `Ctrl+W` | Delete word back |
| `Esc` | Interrupt current turn — or, with an approval card up, **deny** it |
| `y` / `a` / `n` | Approve tool once / always / deny (in approval prompt) |
| `r` | Deny **with a reason** — type feedback, `↵` sends it to the model (approval prompt) |
| `e` | Edit the bash command before running it, then `↵` (approval prompt, bash only) |

---

## Tool Approval

When the agent wants to run a bash command or edit/write a file, an **approval card**
pops up showing the real action:

- **Bash** — the exact command, plus the working dir it runs in (`in /path`).
- **Edit / Write** — a `+`/`−` diff of what changes (truncated at 20 lines, with a
  `+N more lines` marker).
- **Danger flag** — destructive commands (`rm -rf`, `sudo`, `git push --force`,
  pipe-to-shell, fork bombs, …) get a **double red border + ⚠ DANGER** instead of the
  calm yellow card. It's a cue, not a block — you still decide.

**Keys:**

| Key | What |
|-----|------|
| `y` | Allow **once** |
| `a` | **Always** — remembers this exact action (command, or tool+file) for the rest of the session; won't ask again |
| `n` / `Esc` | **Deny** (Esc also works, so bailing never blocks the engine) |
| `r` | Deny **with a reason** — type feedback, `↵` sends it to the model so it can adjust |
| `e` | **Edit** the bash command before running (bash only) |

**Read-only tools** (`Read`, `Grep`, `Glob`, `LS`, `WebFetch`, …) are **auto-allowed** —
no prompt — so browsing files doesn't spam you.

> **claude vs codex:** the card above is the **claude** flow (per-tool, interactive via
> the SDK's `canUseTool`). **Codex** has no inline approval hook in its SDK yet, so it's
> governed by a sandbox (`workspace-write` + `approvalPolicy: on-failure`) and the channel
> sees **one decision per turn**, not per tool. `y/a/n` on a codex turn allow/deny the
> whole turn.

Use `--yolo` to skip **all** prompts (auto-allow everything). Convenient for trusted
tasks, but there's **no record** of what got auto-run — use with care.

---

## Context Meter

Status line shows: `ctx 47%` — percentage of the model's context window used (based on real token counts from the API).

When it gets high (>80%), use `/compact` to summarize.

---

## Troubleshooting

**"agentnet needs an interactive terminal"**
→ Running piped or in a non-TTY. Run directly in a real terminal, not `| cat`.

**"Native CLI binary not found" or claude hangs**
→ `claude --version` fails. Fix: `npm install -g @anthropic-ai/claude-code` then `claude login`.

**Codex shows "exited with code 1: Reading prompt from stdin"**
→ Usually a usage limit on your OpenAI account (not a code bug). Check `codex doctor` or your OpenAI billing.

**"Dynamic require of buffer not supported"**
→ Build issue (source builds only). Run `pnpm install` then `pnpm build:cli`.

**Animations look broken in some terminals**
→ Run with `--calm` flag. Or set `NO_COLOR=1` in env.

**Session not found on resume**
→ Sessions are wallet-keyed. Make sure you're using the same `~/.config/solana/id.json` keypair.

---

## Quick Start (TL;DR)

```bash
# 1. prereqs
npm install -g @anthropic-ai/claude-code
claude login

# 2. install
npm install -g @iqlabs-official/agentnet-cli

# 3. run
agentnet

# 4. test
# Type a message → watch claude respond with tool cards
# Type /new → new session
# Type !ls → bash passthrough
# Press Esc mid-turn → interrupt
```
