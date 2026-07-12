/* issue #115 hypothesis probe — recvfrom is the corrupted data path.
 *
 * proot's seccomp filter traps recvfrom/recvmsg (syscall/seccomp.c) but NOT read.
 * On aarch64 Linux there is no `recv` syscall, so every glibc/OpenSSL socket receive
 * lowers to the recvfrom syscall — meaning ALL of git's pack/TLS bytes cross proot's
 * traced recvfrom handler. read() is byte-identical when flags==0 && src_addr==NULL,
 * and is NOT trapped, so routing through it bypasses the handler entirely.
 *
 * If LD_PRELOAD'ing this makes in-app `git clone` succeed under untrusted_app, the
 * recvfrom trap is the corruption site — a precise, testable root cause.
 */
#define _GNU_SOURCE
#include <sys/syscall.h>
#include <sys/socket.h>
#include <unistd.h>

ssize_t recvfrom(int fd, void *buf, size_t len, int flags,
                 struct sockaddr *src_addr, socklen_t *addrlen) {
    if (flags == 0 && src_addr == NULL)
        return syscall(SYS_read, fd, buf, len);            /* untrapped path */
    return syscall(SYS_recvfrom, fd, buf, len, flags, src_addr, addrlen);
}
