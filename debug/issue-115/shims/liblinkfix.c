/* issue #115 — CANDIDATE FIX (broad). Gated on probe9 confirming proot's link() is a false
 * success on .git/objects paths (link ret=0, target_exists_after=0).
 *
 * PREFER the config fix first (probe10): `git config core.createObject rename` skips link()
 * for git with zero native code. Use THIS shim only if a NON-git tool (npm/cargo/…) also hits
 * the same link false-success and has no equivalent config — it covers every tool at once.
 *
 * Mechanism: git 2.43 finalize_object_file() falls back to rename() on ANY link error except
 * EEXIST (object-file.c, verified). rename() works under proot (probe6). So for object-path
 * links we DON'T call the broken proot link — we return EXDEV, forcing the caller's own tested
 * rename fallback. Scoped to "/objects/" so real hardlinks elsewhere are untouched. Covers both
 * link() and linkat() in case git/the tool issues the *at form.
 *
 * Stage like the other shims (guest is aarch64 GLIBC, no NDK):
 *   zig cc -target aarch64-linux-gnu -shared -fPIC -O2 -o liblinkfix.so liblinkfix.c
 * then LD_PRELOAD=/root/liblinkfix.so <tool>.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/syscall.h>

static int obj(const char *p) { return p && strstr(p, "/objects/") != 0; }

int link(const char *a, const char *b) {
    if (obj(a) || obj(b)) { errno = EXDEV; return -1; }  /* force the caller's rename fallback */
    return syscall(SYS_linkat, AT_FDCWD, a, AT_FDCWD, b, 0);
}

int linkat(int fda, const char *a, int fdb, const char *b, int flags) {
    if (obj(a) || obj(b)) { errno = EXDEV; return -1; }
    return syscall(SYS_linkat, fda, a, fdb, b, flags);
}
