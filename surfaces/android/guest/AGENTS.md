# Runtime environment notes (read before acting)

You are running inside a **proot-distro Ubuntu** guest on an **Android phone** — not a
normal Linux machine and not a server. proot emulates a glibc Linux filesystem over the
phone's storage via ptrace. Most things work, but a few Linux assumptions break here.
Follow these so you don't waste turns on commands that can't work or that are slow.

This file is shipped by the AgentNet app for ALL mobile users (they can't write it
themselves), so keep behavior conservative and self-explanatory.

## What is NOT available (hard failures — don't try)

- **No systemd / init.** `systemctl`, `service`, `journalctl` do nothing useful and
  will error. To run something in the background, use `nohup … &` or a plain `&`.
- **No root daemons / kernel modules.** Don't `modprobe`, don't touch `/sys` writes,
  don't expect `sudo` to grant real privileges (you already appear as uid 0 in the
  guest, but the Android kernel below still restricts you).
- **Some `/proc` entries are restricted** by Android. Reading `/proc/cpuinfo`,
  `/proc/self/status` etc. may return empty or partial data — don't rely on them.

## What is SLOW here (minimize — proot taxes these)

proot intercepts filesystem and process syscalls. Network calls (the model API) are
NOT taxed, so chat/reasoning is fast. The costly operations are:

- **Mass file churn.** A fresh `npm install`, `pip install`, or a full build touches
  thousands of files and feels sluggish. Prefer what's already installed; install only
  the minimum; avoid "reinstall everything" steps.
- **Spawning many short-lived processes.** A recursive shell loop that forks per file
  is slow. Use one `rg` (ripgrep, preinstalled) instead of `find … -exec grep`; batch
  operations instead of looping subprocesses.
- **Process startup.** Each new process pays proot's exec cost. Don't re-launch a tool
  per item when one invocation can do the batch.

## Tool guidance

- **Use `rg` (ripgrep) for search**, not recursive `grep`/`find` loops.
- **Git is available.** codex requires a git repo — if you're outside one, `git init`
  first (the app may pass `--skip-git-repo-check`, but a real repo is cleaner).
- Keep edits surgical; large tree-wide rewrites multiply the per-file syscall cost.

<!-- TODO (after on-device measurement): this list is from documented proot behavior,
     not yet verified on our exact rootfs. Once the shell boots a real guest, measure
     which commands actually fail/slow here and tighten this file with real findings
     (e.g. specific package managers, any codex/claude flags that misbehave under
     proot, the PR_SET_DUMPABLE issue on some codex versions). Don't guess past this. -->
