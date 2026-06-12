# OAuth / Login on Mobile — Research Notes

How claude/codex login behaves on a phone (Termux/Android), and why the common
"OAuth is broken, use an API key" advice is misleading. Facts gathered before any
coding. (As of 2026-06. Anthropic policy is in flux, so dates are stamped.)

Related: [../mobile-strategy.md](../mobile-strategy.md) (Android = proot-distro, runs
claude whole, authenticates with the user's subscription = cheap).

## TL;DR

- **Login does NOT break.** What people call "OAuth broken on Termux" is only the
  **final auto-redirect step** failing — not the login itself, not the credentials.
- Root cause: the phone browser **can't reach the CLI's `localhost:<random-port>/callback`
  server**, so instead of redirecting it just **shows a login code on screen**. Same issue
  as WSL2 / SSH / containers.
- **You do NOT need to switch to an API key.** Three OAuth-preserving fixes exist; the
  cleanest for our case is **`claude setup-token`** (1-year OAuth token, authenticates with
  the **subscription** — not pay-per-token).
- So "OAuth broken" is **not a blocker for Plan A** (proot bundle). It's a known one-time
  handshake quirk with a documented fix.

## What actually happens (verified)

Claude Code OAuth flow:

1. Browser opens → user logs into Anthropic.
2. On success the browser is supposed to redirect to **`http://localhost:<random-port>/callback`**,
   where the CLI is listening, and the CLI grabs the code automatically.

**Only step 2 fails on Termux/SSH/containers/WSL.** The phone browser can't reach the
CLI's local callback server, so the browser **displays a login code instead of redirecting**.
The login and the credentials are fine — only the auto-handoff of the code is missing.

## Fixes (all keep OAuth / subscription — no API key)

| Fix | How | Notes |
|---|---|---|
| **1. Paste the code manually** | Browser shows a code → paste it at the CLI's `Paste code here if prompted` prompt | Officially supported fallback. One manual step. OAuth unchanged. |
| **2. `claude setup-token`** ⭐ | Runs the OAuth flow and **prints a 1-year OAuth token**; set it as `CLAUDE_CODE_OAUTH_TOKEN` | **Authenticates with Pro/Max/Team subscription** (NOT pay-per-token API). Best fit for us. No repeated handshakes for a year. |
| **3. Token is cached after first login** | After the one-time manual login (fix 1), Claude Code stores the OAuth token and reuses it next sessions | So the quirk is a **first-run-only** concern. |

### Why "use an API key" was misleading
That advice is for **truly headless boxes (VPS) with no browser at all**. A **phone has a
browser**, so fixes 1 & 2 work. For our case (phone + use the subscription), the right
answer is **`setup-token`, not an API key** — it sidesteps the localhost-redirect problem
while keeping OAuth/subscription billing.

## Why this is good news for Plan A (proot bundle)

The app's auth flow becomes clean:

1. App runs `claude setup-token` once → user logs in via the phone browser with their
   subscription → gets a 1-year token.
2. Store it as `CLAUDE_CODE_OAUTH_TOKEN`.
3. For a year: no re-login, subscription billing, **server still 0**.

So "OAuth broken" does **not** kill Plan A.

## ⚠️ Open question — NOT solved here (separate from the OAuth tech issue)

Storing the user's OAuth token in the app means **the app holds the user's subscription
credential and runs claude on their behalf**. Whether that is **allowed by Anthropic's ToS**
is a *terms* question, not a *technical* one. This is the same thread as mobile-strategy.md's
open item: **"2026-06-15 — confirm Agent SDK subscription credit limits & terms."** Resolve
that before shipping Plan A.

## Sources

- Claude Code Docs — Authentication (`setup-token`, manual code paste):
  https://code.claude.com/docs/en/authentication
- Claude Help — Troubleshoot installation/auth (localhost redirect fallback):
  https://support.claude.com/en/articles/14552646-troubleshoot-claude-code-installation-and-authentication
- anthropics/claude-code #29507 — manual callback URL paste fallback:
  https://github.com/anthropics/claude-code/issues/29507
- wanderseven — Termux install/login guide (token cached & reused):
  https://www.wanderseven.com/2026/05/install-claude-code-termux-android-guide.html
