echo "=== O_TMPFILE direct test (the suspected git object-write path) ==="
python3 - <<'PY'
import os, errno
try:
    fd = os.open("/tmp", os.O_TMPFILE | os.O_RDWR, 0o644)
    os.write(fd, b"tmpfile-payload-12345")
    print("step1 O_TMPFILE open+write: OK (fd=%d)" % fd)
    try:
        os.link("/proc/self/fd/%d" % fd, "/tmp/otmp_linked", src_dir_fd=None, follow_symlinks=True)
        print("step2 link via /proc/self/fd: OK size=%d" % os.path.getsize("/tmp/otmp_linked"))
        print("RESULT: O_TMPFILE fully works -> NOT the cause")
    except Exception as e:
        print("step2 link via /proc/self/fd: FAILED (%s)" % e)
        print("RESULT: O_TMPFILE opens but cannot be linked -> THIS is the git object-loss cause")
except OSError as e:
    if e.errno in (errno.EOPNOTSUPP, errno.EISDIR, errno.ENOTSUP):
        print("O_TMPFILE unsupported (%s) -> git should fall back to mkstemp; NOT the cause" % e)
    else:
        print("O_TMPFILE open failed unexpectedly: %s" % e)
PY
echo "=== control: does git write objects if we force a non-tmpfile temp dir? ==="
echo "(informational: git has no direct off-switch; the LD_PRELOAD shim in the handoff does it)"
echo "=== DONE ==="
