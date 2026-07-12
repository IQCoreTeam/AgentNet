/* issue #115 — instrument git's REAL loose-object finalize path (no guessing).
 * git 2.43 object-file.c: create_tmpfile -> git_mkstemp_mode -> open(O_CREAT|O_EXCL,0444);
 * then finalize_object_file() does link(tmp,final) [rename fallback], then unlink(tmp);
 * close_loose_object() fsyncs first. So the syscalls that decide whether the object lands
 * are link / rename / fsync. Hook exactly those, log calls touching .git/objects, and after
 * a link/rename CHECK whether the target actually exists. If link returns 0 but the target
 * is absent, proot's link is a false success — that is the corruption, proven not guessed.
 */
#define _GNU_SOURCE
#include <fcntl.h>
#include <unistd.h>
#include <string.h>
#include <stdio.h>
#include <errno.h>
#include <sys/syscall.h>

static void logline(const char *m) {
    int fd = syscall(SYS_openat, AT_FDCWD, "/root/objtrace.log",
                     O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (fd >= 0) { syscall(SYS_write, fd, m, strlen(m)); syscall(SYS_close, fd); }
}
static int obj(const char *p) { return p && strstr(p, "/objects/") != 0; }
static int exists(const char *p) { return syscall(SYS_faccessat, AT_FDCWD, p, F_OK, 0) == 0; }

int link(const char *a, const char *b) {
    int r = syscall(SYS_linkat, AT_FDCWD, a, AT_FDCWD, b, 0);
    int e = errno;
    if (obj(a) || obj(b)) {
        char m[600];
        snprintf(m, sizeof m, "link ret=%d errno=%d target_exists_after=%d  %s -> %s\n",
                 r, r < 0 ? e : 0, exists(b), a, b);
        logline(m);
    }
    errno = e;
    return r;
}

int rename(const char *a, const char *b) {
    int r = syscall(SYS_renameat, AT_FDCWD, a, AT_FDCWD, b);
    int e = errno;
    if (obj(a) || obj(b)) {
        char m[600];
        snprintf(m, sizeof m, "rename ret=%d errno=%d target_exists_after=%d  %s -> %s\n",
                 r, r < 0 ? e : 0, exists(b), a, b);
        logline(m);
    }
    errno = e;
    return r;
}

int fsync(int fd) {
    int r = syscall(SYS_fsync, fd);
    int e = errno;
    char m[128];
    snprintf(m, sizeof m, "fsync fd=%d ret=%d errno=%d\n", fd, r, r < 0 ? e : 0);
    logline(m);
    errno = e;
    return r;
}
