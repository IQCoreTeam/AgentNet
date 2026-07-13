# issue #115 — CANDIDATE FIX test. Gated on probe9 first confirming `link ret=0
# target_exists_after=0` for .git/objects (proot's link() is a false success).
#
# git 2.43 finalize_object_file() (object-file.c): if core.createObject=rename
# (OBJECT_CREATION_USES_RENAMES) it `goto try_rename` and SKIPS link() entirely, using
# rename() — which works under proot (probe6: 50 renames survive, 50 link-writes vanish).
# So the interim fix is one line of git config: no LD_PRELOAD shim, no proot rebuild.
# probe10 proves it end to end: reproduce the loss in link mode, show it gone in rename mode,
# then a real network clone with the fix.
#
# Run as a TRUE app child (paste into the in-app agent chat), never run-as:
#   run sh /root/probe10.sh and save the full output to /root/probe10_result.txt
# then: adb shell "run-as com.iqlabs.agentnet cat files/rootfs/root/probe10_result.txt"
set -u

echo "=== baseline: link mode (git default) — expect objects to VANISH ==="
rm -rf /root/o_link; git init -q /root/o_link; cd /root/o_link
ok=0; for i in $(seq 1 50); do git hash-object -w --stdin <<EOF >/dev/null 2>&1 && ok=$((ok+1))
obj-$i
EOF
done
echo "link mode  : hash-object reported ok=$ok/50  survivors_on_disk=$(find .git/objects -type f | wc -l)"

echo "=== fix: core.createObject=rename — expect all 50 to SURVIVE ==="
rm -rf /root/o_rename; git init -q /root/o_rename; cd /root/o_rename
git config core.createObject rename
ok=0; for i in $(seq 1 50); do git hash-object -w --stdin <<EOF >/dev/null 2>&1 && ok=$((ok+1))
obj-$i
EOF
done
echo "rename mode: hash-object reported ok=$ok/50  survivors_on_disk=$(find .git/objects -type f | wc -l)"

echo "=== real clone WITH the fix (global) — expect exit 0 + clean fsck ==="
git config --global core.createObject rename
cd /root; rm -rf exq
git clone -q https://github.com/expressjs/express.git exq 2>&1 | tail -3; echo "clone exit=$?"
( cd exq 2>/dev/null && git fsck 2>&1 | tail -3 )
git config --global --unset core.createObject 2>/dev/null

echo "=== VERDICT: fix works iff rename-mode survivors=50 AND clone exit=0 AND fsck clean ==="
echo "=== DONE ==="
