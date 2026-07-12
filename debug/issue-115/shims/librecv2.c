/* issue #115 — recv-symbol bypass + census.
 * The recvfrom-SYMBOL hook saw 0 calls: curl calls recv(), and glibc lowers that to the
 * recvfrom SYSCALL internally, bypassing a recvfrom symbol interposer. So hook the symbols
 * curl actually calls — recv / recvfrom / recvmsg — and for the plain no-flags case route
 * through the read SYSCALL, which proot does NOT trap. If clone now succeeds, the recvfrom
 * syscall trap is the corruption site. Each process also dumps a call census to /root.
 */
#define _GNU_SOURCE
#include <sys/syscall.h>
#include <sys/socket.h>
#include <unistd.h>
#include <fcntl.h>
#include <stdio.h>

static long c_recv, c_recvfrom, c_recvmsg, bypass_bytes;

ssize_t recv(int fd, void *b, size_t n, int f) {
    c_recv++;
    ssize_t r = (f == 0) ? syscall(SYS_read, fd, b, n)
                         : syscall(SYS_recvfrom, fd, b, n, f, 0, 0);
    if (r > 0) bypass_bytes += r;
    return r;
}

ssize_t recvfrom(int fd, void *b, size_t n, int f, struct sockaddr *sa, socklen_t *al) {
    c_recvfrom++;
    if (f == 0 && sa == 0) {
        ssize_t r = syscall(SYS_read, fd, b, n);
        if (r > 0) bypass_bytes += r;
        return r;
    }
    return syscall(SYS_recvfrom, fd, b, n, f, sa, al);
}

ssize_t recvmsg(int fd, struct msghdr *m, int f) {   /* census only */
    c_recvmsg++;
    return syscall(SYS_recvmsg, fd, m, f);
}

__attribute__((destructor))
static void dump(void) {
    char comm[64] = {0};
    int cf = syscall(SYS_openat, AT_FDCWD, "/proc/self/comm", O_RDONLY, 0);
    if (cf >= 0) { syscall(SYS_read, cf, comm, 63); syscall(SYS_close, cf); }
    for (char *p = comm; *p; p++) if (*p == '\n') *p = 0;
    char path[160], buf[256];
    snprintf(path, sizeof path, "/root/trace-%d-%s", (int)getpid(), comm);
    int fd = syscall(SYS_openat, AT_FDCWD, path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd < 0) return;
    int n = snprintf(buf, sizeof buf, "recv=%ld recvfrom=%ld recvmsg=%ld bypass_bytes=%ld\n",
                     c_recv, c_recvfrom, c_recvmsg, bypass_bytes);
    syscall(SYS_write, fd, buf, n);
    syscall(SYS_close, fd);
}
