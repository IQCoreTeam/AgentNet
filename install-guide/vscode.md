# Running AgentNet in VS Code

How to run the AgentNet **VS Code extension** — the agent inside your editor. No prior
extension-development experience needed.

> Pre-release (devnet). Once released, install it straight from the VS Code Marketplace.

- [How this differs from the phone app](#how-this-differs-from-the-phone-app)
- [What you need](#what-you-need)
- [Step 1 — Install the agent CLIs](#step-1--install-the-agent-clis)
- [Step 2 — Get the code & build](#step-2--get-the-code--build)
- [Step 3 — Launch the extension (F5)](#step-3--launch-the-extension-f5)
- [Step 4 — Open the chat](#step-4--open-the-chat)
- [Troubleshooting](#troubleshooting)

---

## How this differs from the phone app

Unlike the Android app (which carries its **own** claude/codex inside a sandbox on the
phone), the VS Code extension uses the **claude / codex CLI installed on your computer**.
It finds them on your `PATH` and runs them directly.

So the order matters: **install and sign into the CLIs first**, then run the extension.

---

## What you need

- **VS Code** — https://code.visualstudio.com
- **Node.js 20+** and **pnpm** (the repo is a pnpm workspace).
  - Install Node: https://nodejs.org (LTS).
  - Install pnpm: `npm install -g pnpm`
- **claude** and/or **codex** CLI installed and logged in (see Step 1).
- The repo cloned to your computer.

---

## Step 1 — Install the agent CLIs

The extension runs whichever of these you have. Install at least one.

**Claude Code:**
```bash
npm install -g @anthropic-ai/claude-code
claude        # run once, sign in with your Claude subscription
```

**Codex:**
```bash
npm install -g @openai/codex
codex login   # sign in
```

Verify they're on your PATH:
```bash
claude --version
codex --version
```
If a command isn't found, the extension won't be able to spawn it — make sure `npm`'s
global bin is on your `PATH`.

---

## Step 2 — Get the code & build

From the repo root:

```bash
pnpm install              # install all workspace deps
pnpm build:core           # build the shared core
pnpm build:vscode         # build the extension (outputs surfaces/vscode/dist)
```

> 💡 While developing, `pnpm --filter agentnet-vscode watch` rebuilds the extension on
> every change.

---

## Step 3 — Launch the extension (F5)

The extension runs in a second VS Code window ("Extension Development Host").

1. Open the **`surfaces/vscode`** folder in VS Code:
   `File → Open Folder…` → select `surfaces/vscode`.
2. Press **F5** (or **Run → Start Debugging**). A launch config named **"Run AgentNet
   Extension"** is already set up.
3. A new VS Code window opens — that's the Extension Development Host with AgentNet loaded.

> If F5 does nothing, make sure you opened the **`surfaces/vscode`** folder (the
> `.vscode/launch.json` lives there), and that you ran `pnpm build:vscode` first.

---

## Step 4 — Open the chat

In the new (Extension Development Host) window:

1. Open the Command Palette: **Cmd+Shift+P** (Mac) / **Ctrl+Shift+P** (Windows).
2. Run **"AgentNet: Open Chat"** (or **"AgentNet: New Chat (new tab)"** for a fresh tab).
3. Follow the onboarding (connect a wallet, then pick claude or codex). The agent runs via
   your installed CLI and its session, right inside the editor.

---

## Troubleshooting

- **F5 launches but no AgentNet command appears:** run `pnpm build:vscode` (the extension
  needs `surfaces/vscode/dist/extension.js`), then F5 again. Check the Debug Console in the
  first window for build/activation errors.
- **"command not found" / agent doesn't respond:** the `claude`/`codex` CLI isn't on the
  PATH that VS Code sees. Confirm `claude --version` works in a normal terminal; if you
  installed via a version manager (nvm/asdf), launch VS Code from that same shell so it
  inherits the PATH.
- **"Not logged in":** run `claude` / `codex login` once in a terminal to sign in; the
  extension reuses that login.
- **Changes don't show up:** rebuild (`pnpm build:vscode`) or run the `watch` task, then
  reload the Extension Development Host window (**Cmd/Ctrl+R** in that window).
