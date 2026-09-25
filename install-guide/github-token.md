# GitHub token — for agents doing git work

AgentNet lets your agent clone, push, and open PRs on GitHub using a token **you** register
in the app. The token stays on the host (never in the webview, never in chat) and is injected
into the agent's environment when it runs. This page explains how an agent should find and use
it — and what to tell the user when it isn't there.

## For agents: how to use it

**Your git is already authenticated.** When AgentNet spawns you, it injects the user's GitHub
token into your environment as `GH_TOKEN` and `GITHUB_TOKEN`, plus a `github.com`-only git
credential helper (`GIT_CONFIG_*`). You do **not** need to put a token in remote URLs.

Just clone/push over HTTPS:

```bash
git clone https://github.com/<owner>/<repo>.git
# edit, commit…
git push origin <branch>
```

The `gh` CLI and any scripts pick up `GH_TOKEN`/`GITHUB_TOKEN` automatically too. Public
clones work with no token at all; the helper only kicks in on a 401 (private repos, pushes).

### Verify before you assume it's missing

```bash
# Is a token present in this environment?
test -n "$GH_TOKEN" && echo "token: present" || echo "token: NOT in env"

# Does auth actually work against the repo you want?
git ls-remote https://github.com/<owner>/<repo>.git >/dev/null 2>&1 \
  && echo "auth: ok" || echo "auth: failed"
```

If `GH_TOKEN` is empty in a plain shell, that alone doesn't mean the user never registered
one — a shell you opened yourself may not inherit the injected env. The token is persisted on
the host at:

```
~/.agentnet/tokens/github.json      # { "token": "ghp_..." }  (0600, owner-only)
```

(Or `$AGENTNET_HOME/tokens/github.json` if `AGENTNET_HOME` is set.) If that file has a
`token`, auth is available even when your current shell's env is bare — re-run git the way
AgentNet spawns it, or read the token from that file for a one-off command. **Never print the
token, paste it into a URL you log, or copy it into chat.**

## If there is NO token: tell the user to register one

When `~/.agentnet/tokens/github.json` is absent (or `git ls-remote` on a private repo returns
`Authentication failed`), the user hasn't added a token yet. Don't guess or ask for it in
chat — point them at the in-app setting:

> **AgentNet → Settings → GitHub → paste a GitHub token.**
> Create the token at <https://github.com/settings/tokens> with the **`repo`** scope
> (classic PAT) or an equivalent fine-grained token with Contents + Pull requests
> read/write on the repos you want. Paste it once; it's stored on the device only.

The same screen shows the current status (`connected · ••••abcd`) and a **Register GitHub
work** action for linking a repo to your agent.

## Finding the AgentNet source repo

AgentNet is one codebase, many surfaces. The source lives at:

```
https://github.com/IQCoreTeam/AgentNet
```

Clone it like any other repo (public, so no token needed to read):

```bash
git clone https://github.com/IQCoreTeam/AgentNet.git
```

Layout: pnpm monorepo — `packages/core` (shared engine), `packages/mcp`, and one folder per
surface under `surfaces/` (`android`, `cli`, `desktop`, `localhost`, `vscode`, `webview`).
