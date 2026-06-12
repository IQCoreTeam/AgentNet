# AgentNet CLI — Dev Running Guide

For new devs testing the CLI surface (`surfaces/cli`).

---

## Prerequisites

### 1. Node / pnpm

```bash
node -v   # need v20+
pnpm -v   # need v9+
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

---

## Setup

Clone + install from the repo root:

```bash
cd /path/to/AgentNet
pnpm install
```

Build core first (CLI depends on it):

```bash
pnpm build:core
```

---

## Running (dev mode — no build needed)

```bash
# From repo root:
pnpm dev:cli

# Or from surfaces/cli directly:
cd surfaces/cli
pnpm dev
```

This runs `tsx src/index.tsx` — hot-reloads on save (via tsx watch).

You'll see:
1. Animated IQ banner
2. Boot checklist (claude ✓ / codex ✓ / wallet ✓)
3. Onboarding screen (first time only — picks storage location)
4. Chat REPL

---

## Running (built binary)

```bash
# Build once:
pnpm build:cli

# Run:
node surfaces/cli/dist/cli.js

# Or install globally to get `agentnet` command:
npm install -g ./surfaces/cli
agentnet
```

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
| `Esc` | Interrupt current turn |
| `y` / `a` / `n` | Approve tool once / always / deny (in approval prompt) |

---

## Tool Approval

When claude wants to run a bash command or edit a file, an **approval card** pops up showing:
- The exact command or diff
- `[y] once  [a] always  [n] deny`

Use `--yolo` to skip all prompts (useful for trusted tasks).

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
→ Build issue. Run `pnpm install` then `pnpm build:core && pnpm build:cli`.

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

# 2. setup
cd AgentNet && pnpm install && pnpm build:core

# 3. run
pnpm dev:cli

# 4. test
# Type a message → watch claude respond with tool cards
# Type /new → new session
# Type !ls → bash passthrough
# Press Esc mid-turn → interrupt
```

---

## Branch

All CLI work is on `feat/agentnet-cli`. Base branch: `agentnet` (from `main`).

```bash
git checkout feat/agentnet-cli
```
