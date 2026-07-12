/* issue #115 candidate fix/probe — strip O_TMPFILE so git falls back to mkstemp+rename.
 * git writes loose objects via O_TMPFILE (anonymous temp inode) then names it through
 * /proc/self/fd. proot appears to mishandle that path (object files never land on disk;
 * probe6: hash-object reports ok, 0 files survive). Forcing O_TMPFILE to fail makes git's
 * create_tmpfile() fall back to a named mkstemp temp file + rename, which proot handles
 * (probe6 A/B: plain rename works). If clone succeeds with this preloaded, O_TMPFILE is
 * the root cause and this shim (or a proot linkat/O_TMPFILE fix) is the remedy.
 */
#define _GNU_SOURCE
#include <fcntl.h>
#include <stdarg.h>
#include <errno.h>
#include <sys/syscall.h>
#include <unistd.h>

int openat(int dirfd, const char *path, int flags, ...) {
    mode_t mode = 0;
    if (flags & (O_CREAT | O_TMPFILE)) {
        va_list ap; va_start(ap, flags); mode = va_arg(ap, int); va_end(ap);
    }
    if ((flags & O_TMPFILE) == O_TMPFILE) { errno = EOPNOTSUPP; return -1; }
    return syscall(SYS_openat, dirfd, path, flags, mode);
}

int open(const char *path, int flags, ...) {
    mode_t mode = 0;
    if (flags & (O_CREAT | O_TMPFILE)) {
        va_list ap; va_start(ap, flags); mode = va_arg(ap, int); va_end(ap);
    }
    if ((flags & O_TMPFILE) == O_TMPFILE) { errno = EOPNOTSUPP; return -1; }
    return syscall(SYS_openat, AT_FDCWD, path, flags, mode);
}
