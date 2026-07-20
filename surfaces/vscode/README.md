# AgentNet for VS Code

Chat with Claude Code and Codex inside VS Code, with sessions that follow you across
devices and a built-in marketplace of agent skills.

AgentNet keeps your chat history in storage you choose rather than a vendor backend, so
the same sessions are available on every AgentNet surface (VS Code, CLI, and mobile).

## Requirements

- VS Code 1.90 or newer.
- The [Claude Code](https://claude.com/claude-code) CLI, the
  [Codex](https://developers.openai.com/codex/cli) CLI, or both, installed and on your PATH.
  The extension spawns the CLI you already have; it does not bundle one.

## Getting started

1. Install the extension and run **AgentNet: Open Chat** from the Command Palette.
2. On first run, onboarding sets up your AgentNet account and offers a place to keep
   sessions: Google Drive, iCloud Drive, a custom S3/WebDAV/HTTP endpoint, or this device
   only.
3. Sign in to Claude or Codex from the chat panel, then start working.

Storage is optional. Choosing "this device only" keeps everything local, and you can switch
later without losing history.

## Commands

| Command | Description |
| --- | --- |
| `AgentNet: Open Chat` | Open the chat panel, reusing the current one if it is already open. |
| `AgentNet: New Chat (new tab)` | Open an additional chat panel in its own tab. |

Panels share one account and one session list, so every tab sees the same history.
Approvals are per panel and never cross between tabs.

## Skills

The chat panel includes the AgentNet skill marketplace. You can search published skills,
read them before buying, and equip one to the agent. Ownership is recorded to your
AgentNet account on Solana mainnet, so purchased skills travel with your account rather
than with this editor. Buying a skill is a paid transaction; the price is shown before you
confirm.

## Links

- [Source and issues](https://github.com/IQCoreTeam/AgentNet)

## License

Apache-2.0. See [LICENSE](./LICENSE).
