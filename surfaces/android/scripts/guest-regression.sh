#!/bin/sh
# Silent-death regression suite for the proot guest. Run after ANY targetSdk / SELinux-domain
# change (first written for the 35 -> 36 bump; see issue #130).
#
# Why this exists: the 28 -> 35 history (#112/#116/#117) proved the exec wall is not the real
# risk — a newer untrusted_app domain quietly changes SIDE syscalls (link, /proc reads), and
# layers that fake success turn honest failures into silent data loss. A booting server and
# HTTP 200 prove almost nothing, so each test here asserts a CONTRADICTION check (reported
# success must match on-disk reality), not just an exit code.
#
# THE ONE HARD RULE (from the #115 hunt): these bugs reproduce ONLY in the app's own SELinux
# domain (untrusted_app). `adb shell run-as` runs in runas_app and does NOT reproduce them —
# a 56-clone run-as harness passed while the in-app path failed 100%. So:
#   stage (host):   base64 -i scripts/guest-regression.sh | adb shell \
#                     "run-as com.iqlabs.agentnet sh -c 'base64 -d > files/rootfs/root/regression.sh'"
#   run:            paste into the IN-APP agent chat:
#                     run `sh /root/regression.sh` and show me the full output
#   collect (host): adb shell "run-as com.iqlabs.agentnet cat files/rootfs/root/regression_result.txt"
# (run-as is fine for staging/reading files — same uid — just never for EXECUTING the probes.)
#
# POSIX sh only: the guest /bin/sh is dash.

OUT=/root/regression_result.txt
: > "$OUT"
PASS=0; FAIL=0; WARN=0
say() { echo "$@" | tee -a "$OUT"; }
pass() { PASS=$((PASS+1)); say "PASS $*"; }
fail() { FAIL=$((FAIL+1)); say "FAIL $*"; }
warn() { WARN=$((WARN+1)); say "WARN $*"; }

WORK=/tmp/regression.$$
mkdir -p "$WORK" && cd "$WORK" || { say "FATAL cannot create $WORK"; exit 1; }

say "== guest regression suite: $(uname -m) $(date 2>/dev/null || echo 'no-date') =="

# T1 hardlink honesty — the #116 class. Three acceptable outcomes, one fatal:
#   honest failure (EACCES, old proot)              -> PASS
#   real success via --copy-on-link (b exists+matches) -> PASS
#   reported success but b missing/mismatched       -> FAIL (the l2s lie is back)
echo hello > a
if ln a b 2>/dev/null; then
  if [ -e b ] && [ "$(cat b)" = "hello" ]; then pass "hardlink: link succeeded and target is real (copy-on-link)"
  else fail "hardlink: link reported success but target missing/wrong — SILENT-LIE regression (#116 class)"; fi
else
  pass "hardlink: link failed honestly (callers' fallbacks will fire)"
fi
rm -f a b

# T2 git loose-object survival — probe6 pattern from the #115 kit: write 50 objects, count
# what actually lands on disk. git reports success either way; the disk is the truth.
if command -v git >/dev/null 2>&1; then
  git init -q objrepo && cd objrepo
  i=0; while [ $i -lt 50 ]; do echo "obj$i" | git hash-object -w --stdin >/dev/null; i=$((i+1)); done
  SURV=$(find .git/objects -type f ! -path '*/pack/*' ! -name '*.pack' ! -name '*.idx' | wc -l | tr -d ' ')
  if [ "$SURV" -eq 50 ]; then pass "git objects: 50/50 loose objects survive"
  else fail "git objects: only $SURV/50 survive — silent object loss (#115/#116 class)"; fi
  cd "$WORK"
else
  warn "git objects: git not installed, skipped"
fi

# T3 real network clone + fsck — the original #112 reproducer repo.
if command -v git >/dev/null 2>&1; then
  if git clone -q https://github.com/expressjs/express.git 2>clone.err; then
    if git -C express fsck --no-progress >fsck.out 2>&1; then pass "git clone: express clone + fsck clean"
    else fail "git clone: fsck found corruption: $(head -3 fsck.out | tr '\n' ' ')"; fi
  else
    fail "git clone: clone failed: $(head -3 clone.err | tr '\n' ' ')"
  fi
else
  warn "git clone: git not installed, skipped"
fi

# T4 pnpm install — success must equal a loadable module, not just exit 0.
if command -v pnpm >/dev/null 2>&1; then
  mkdir -p pnpmtest && cd pnpmtest && echo '{"name":"t","version":"1.0.0"}' > package.json
  if pnpm add express --silent >pnpm.log 2>&1 && node -e "require('express')" 2>/dev/null; then
    pass "pnpm: express installs and require() resolves ($(find node_modules -type f | wc -l | tr -d ' ') files)"
  else
    fail "pnpm: install or require failed (see pnpm.log): $(tail -2 pnpm.log | tr '\n' ' ')"
  fi
  cd "$WORK"
else
  warn "pnpm: not installed, skipped"
fi

# T5 bun install — #117 class (its hardlink backend fails silently without the wrapper).
if command -v bun >/dev/null 2>&1; then
  mkdir -p buntest && cd buntest && echo '{"name":"t","version":"1.0.0"}' > package.json
  if bun add express >bun.log 2>&1 && node -e "require('./node_modules/express')" 2>/dev/null; then
    pass "bun: express installs and require() resolves ($(find node_modules -type f | wc -l | tr -d ' ') files)"
  else
    fail "bun: install produced no loadable module (#117 class): $(tail -2 bun.log | tr '\n' ' ')"
  fi
  cd "$WORK"
else
  warn "bun: not installed, skipped"
fi

# T6 node os APIs — #117 class: they read /proc files the domain may deny.
if command -v node >/dev/null 2>&1; then
  CPUS=$(node -e "console.log(require('os').cpus().length)" 2>/dev/null)
  LOAD=$(node -e "console.log(require('os').loadavg()[0])" 2>/dev/null)
  if [ -n "$CPUS" ] && [ "$CPUS" -gt 0 ] && [ -n "$LOAD" ]; then
    pass "node os: cpus=$CPUS loadavg=$LOAD"
  else
    fail "node os: cpus='$CPUS' loadavg='$LOAD' — /proc read broken (#117 class, check FAKE_PROC binds)"
  fi
else
  warn "node os: node not installed, skipped"
fi

# T7 /proc sweep — covered paths (FAKE_PROC in Installer.kt) must read; a DENIED line on an
# UNCOVERED path is the signal a NEW domain blocks something: add a row to FAKE_PROC.
COVERED="loadavg stat uptime version sys/kernel/cap_last_cap sys/fs/inotify/max_user_watches sys/kernel/overflowuid sys/kernel/overflowgid"
EXTRA="meminfo cpuinfo vmstat sys/kernel/osrelease sys/kernel/pid_max"
for f in $COVERED; do
  if cat "/proc/$f" >/dev/null 2>&1; then pass "/proc/$f readable (covered)"
  else fail "/proc/$f DENIED despite FAKE_PROC coverage — bind not applied?"; fi
done
for f in $EXTRA; do
  if cat "/proc/$f" >/dev/null 2>&1; then say "OK   /proc/$f readable (uncovered, informational)"
  else warn "/proc/$f DENIED and NOT in FAKE_PROC — new denial in this domain; add a row if a tool needs it"; fi
done

cd / && rm -rf "$WORK"
say "== SUMMARY: $PASS pass, $FAIL fail, $WARN warn =="
[ "$FAIL" -eq 0 ] && say "VERDICT: no silent-death regressions detected" || say "VERDICT: REGRESSION — see FAIL lines"
