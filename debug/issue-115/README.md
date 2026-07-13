# issue #115 debug kit — proot loses git object files under untrusted_app

Reproducible assets for the root-cause hunt on `git clone` failing inside the Android proot
guest (`fatal: remote did not send all necessary objects` / `bad object`). Full narrative,
proven eliminations, current hypothesis, and next step live in the
[#115 handoff comment](https://github.com/IQCoreTeam/AgentNet/issues/115). This folder is the
paper trail so anyone can continue on any device.

## The one hard rule

The bug reproduces ONLY in SELinux `u:r:untrusted_app` (the app's own spawned processes).
`adb shell run-as` runs in `u:r:runas_app` and does NOT reproduce it — a 56-clone run-as
harness all passed. **Run every probe as a true child of the app** (paste into the in-app
agent chat), never via run-as. run-as is only for *staging files* and *reading results*.

## Where we are (see the handoff comment for evidence)

Eliminated: rseq, socket receive (recv/read), network entirely (local clone fails too),
`--link2symlink`, plain rename. Narrowed to: **git's loose-object write loses data** —
`git hash-object -w` reports success, 0 files land on disk. The real git path (git 2.43
`object-file.c`) is `mkstemp(0444) -> write -> fsync -> link(tmp,final) -> unlink(tmp)`, so
the guilty syscall is one of `fsync` / `link` / `rename`. **probe9 catches it.**

## Next step

Run probe9 (already staged on the current phone; on a fresh device, stage it first — see below):

```
# in the in-app agent chat, paste:
run sh /root/probe9.sh and save the full output to /root/probe9_result.txt
```
```bash
# then from a desktop with the phone on adb:
adb shell "run-as com.iqlabs.agentnet cat files/rootfs/root/probe9_result.txt"
```

Decision table is in the handoff comment (link at top). Short version: if the log shows
`link ret=0 ... target_exists_after=0`, proot's `link` is a false success — that is the
root cause.

## Candidate fix — run probe10 right after probe9 confirms link

git 2.43 `finalize_object_file()` (object-file.c, verified against v2.43.0): with
`core.createObject=rename` (`OBJECT_CREATION_USES_RENAMES`) it **skips `link()` entirely** and
uses `rename()`, which works under proot (probe6). So the interim fix is **one line of git
config — no shim, no proot rebuild**:

```
run sh /root/probe10.sh and save the full output to /root/probe10_result.txt
```
probe10 reproduces the loss in link mode, shows it gone in rename mode, then does a real
network clone with the fix. Verdict: fixed iff rename-mode survivors=50 AND clone exit=0.

**Fix ladder (apply in order once probe9 names `link`):**
1. **Config, git-only, zero code** — `core.createObject=rename` in the guest (system gitconfig
   or `ServerManager.buildGuestEnv` via `GIT_CONFIG_*`). Fixes the shipping bug (git is the only
   proven-affected tool). Ship this.
2. **`shims/liblinkfix.c`, all tools** — LD_PRELOAD that returns EXDEV on object-path `link`/
   `linkat`, forcing the caller's own rename fallback. Use only if a non-git tool (npm/cargo)
   hits the same link false-success and has no config knob.
3. **Basement, proot `linkat` patch** — fix the false-success in our own proot build (we own it
   from the Seeker process_vm fix; GPLv2 → publish the patch). The true fix: covers every tool,
   no per-tool workaround. This is the long-term "fix the basement" answer.

## How to stage these on a device

```bash
# probe scripts (run-as is fine for writing files — same uid):
for f in probes/probe*.sh; do
  base64 -i "$f" | adb shell "run-as com.iqlabs.agentnet sh -c 'base64 -d > files/rootfs/root/$(basename $f)'"
done

# shims: cross-compile for the guest's aarch64 GLIBC with zig (no Android NDK needed):
for c in shims/*.c; do
  out="lib$(basename ${c%.c} | sed 's/^lib//').so"
  zig cc -target aarch64-linux-gnu -shared -fPIC -O2 -o "/tmp/$out" "$c"
  adb push "/tmp/$out" /data/local/tmp/ >/dev/null
  adb shell "run-as com.iqlabs.agentnet sh -c 'cp /data/local/tmp/$out files/rootfs/root/'"
done
```

Reproducer repo used in the probes: `https://github.com/expressjs/express.git` (large enough
to fail fast); probe4 also has a zero-network local-seed clone.

## Files

- `probes/probe4.sh` — isolates index-pack vs unpack-objects vs local (no-network) clone.
- `probes/probe5.sh` — hardlink behavior + minimal git add/commit/fsck (found: objects vanish).
- `probes/probe6.sh` — rename vs git object-write; counts survivors (50 written, 0 survive).
- `probes/probe7.sh`, `probe8.sh` — O_TMPFILE hypothesis + strip shim. **Disproven**: git 2.43
  uses mkstemp+link, not O_TMPFILE (kept for the record; skip unless re-checking).
- `probes/probe9.sh` — **current**: instruments the real finalize path (`link`/`rename`/`fsync`).
- `shims/libobjtrace.c` — hooks link/rename/fsync, logs calls touching `.git/objects` and
  whether the target exists after. The probe9 shim.
- `shims/librecv2.c`, `recvshim.c`, `traceshim.c` — socket-receive census/bypass shims that
  proved the network is innocent (recv got 10MB, rerouting to read still failed).
- `shims/libnotmpfile.c` — O_TMPFILE strip shim (from the disproven hypothesis).

## Method (do this, in order — don't skip to instrumenting)

1. **Read the source first.** We burned a round guessing O_TMPFILE; `object-file.c` refutes it
   on sight. Find the exact function that issues the syscall, then instrument that.
2. **Never guess — prove.** Back every claim with an on-device experiment or a source line.
3. **One variable per probe.** Change one thing, save the result to a file, read it back.
4. **Dig to the syscall.** Keep narrowing until one syscall is caught returning a value that
   contradicts the filesystem. Stop only when you can name it.
