/* issue #115 diagnostic — measure where the pack stream is lost.
 * Hooks recvfrom (socket receive) and write (pipe hand-off to index-pack), counting
 * calls / bytes / short transfers per process. On exit each process dumps its tally to
 * /root/trace-<pid>-<comm>. Compares: does git-remote-https RECEIVE the full pack from
 * the socket, and does it WRITE the full pack into the pipe? Whichever side is short is
 * the corruption point. No behavior change (real syscalls), pure instrumentation.
 */
#define _GNU_SOURCE
#include <sys/syscall.h>
#include <unistd.h>
#include <fcntl.h>
#include <stdio.h>

static long rc_calls, rc_bytes, rc_short, rc_err;
static long wr_calls, wr_bytes, wr_short, wr_err;

ssize_t recvfrom(int fd, void *b, size_t n, int f, void *sa, void *al) {
    ssize_t r = syscall(SYS_recvfrom, fd, b, n, f, sa, al);
    rc_calls++;
    if (r < 0) rc_err++;
    else { rc_bytes += r; if ((size_t)r < n) rc_short++; }
    return r;
}

ssize_t write(int fd, const void *b, size_t n) {
    ssize_t r = syscall(SYS_write, fd, b, n);
    wr_calls++;
    if (r < 0) wr_err++;
    else { wr_bytes += r; if ((size_t)r < n) wr_short++; }
    return r;
}

__attribute__((destructor))
static void dump(void) {
    char comm[64] = {0};
    int cf = syscall(SYS_openat, AT_FDCWD, "/proc/self/comm", O_RDONLY, 0);
    if (cf >= 0) { syscall(SYS_read, cf, comm, 63); syscall(SYS_close, cf); }
    for (char *p = comm; *p; p++) if (*p == '\n') *p = 0;
    char path[160], buf[320];
    int l = 0;
    for (const char *s = "/root/trace-"; *s; s++) path[l++] = *s;
    l += snprintf(path + l, sizeof path - l, "%d-%s", (int)getpid(), comm);
    path[l] = 0;
    int fd = syscall(SYS_openat, AT_FDCWD, path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd < 0) return;
    int n = snprintf(buf, sizeof buf,
        "recvfrom: calls=%ld bytes=%ld short=%ld err=%ld | write: calls=%ld bytes=%ld short=%ld err=%ld\n",
        rc_calls, rc_bytes, rc_short, rc_err, wr_calls, wr_bytes, wr_short, wr_err);
    syscall(SYS_write, fd, buf, n);
    syscall(SYS_close, fd);
}
