#!/bin/sh
# issue #112 — `git clone` shim for the proot guest.
#
# Under Android's targetSdk-35 `untrusted_app` SELinux domain, proot corrupts git's native
# clone path: the multi-process smart-HTTP pack fetch (git → git-remote-https → index-pack,
# concurrent + piped) truncates the packfile ("remote did not send all necessary objects"),
# and freshly-written objects are briefly invisible across sibling git subprocesses. curl,
# node and single git commands are fine; only git's multi-process object machinery breaks.
# (targetSdk 28 = the looser `untrusted_app_28` domain works, but Play requires 35.)
#
# dulwich (pure-Python git) performs the whole clone in ONE process using plain file I/O —
# the path that works here. Route `clone` through it; everything else uses the real git.
#
# Only the FIRST non-option argument decides the subcommand, so `git commit -m clone` or
# `git checkout clone` pass through untouched. Global option forms that take a value
# (`git -C <dir> clone`, `git -c k=v clone`) also pass through to real git: the value is
# indistinguishable from a subcommand here, and passthrough is the pre-existing behavior.
for a in "$@"; do
  case "$a" in
    -*) continue ;;
    clone) exec python3 /usr/local/bin/agentnet-git-clone.py "$@" ;;
    *) break ;;
  esac
done
exec /usr/bin/git "$@"
