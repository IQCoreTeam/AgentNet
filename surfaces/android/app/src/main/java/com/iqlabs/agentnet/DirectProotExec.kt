package com.iqlabs.agentnet

import android.system.Os
import android.util.Log
import java.io.File

// The stock proot strategy: enter the Ubuntu guest by exec'ing our bundled proot directly
// out of nativeLibDir. proot (not the agent) is what makes glibc binaries work here: it
// ptrace-remaps the guest's "/lib, /usr, /etc" onto the rootfs in app storage, so
// node/claude/codex see a normal Linux. This launch execs the guest's own binaries from app
// storage, so it depends on the targetSdk<=28 W^X exemption — the modern flavor will need
// a linker-routing strategy (exec via the system linker) instead.
//
// Mechanics (ProcessBuilder + host-side proot env) adapted from AnyClaw
// (friuns2/openclaw-android-assistant, MIT). The OpenClaw/Codex-specific install steps are
// NOT copied — our engine is the official CLIs in the proot guest.
class DirectProotExec(private val layout: Paths.Layout) : GuestExec {
    companion object {
        private const val TAG = "AgentNet/Server"
    }

    override fun launch(guestEnv: List<String>, guestCommand: String): Process {
        // prootCommand wraps the launch in `sh -c 'cd <filesDir> && exec proot …'`, so the
        // host cwd is already pinned to a readable dir before proot runs (see the comment
        // there). That's what stops the `getcwd() failed → ENOSYS: uv_cwd` crash.
        val pb = ProcessBuilder(prootCommand(guestEnv, guestCommand))

        // Host-side env for the proot PROCESS (not the guest). These are load-bearing:
        val env = pb.environment()
        env["PROOT_LOADER"] = layout.loader        // proot's own ELF loader helper
        env["PROOT_LOADER_32"] = layout.loader32   // 32-bit loader (guest is 64-bit; set anyway)
        // proot is the Termux build (process_vm=yes), dynamically linked against
        // libtalloc.so.2 + libandroid-shmem.so. Those now ship under jniLibs and the OS
        // extracts them into nativeLibraryDir — so point LD_LIBRARY_PATH there. jniLibs only
        // packages files named lib*.so, so the versioned libtalloc.so.2 had to ship as
        // libtalloc.so; but proot's DT_NEEDED still asks for the soname "libtalloc.so.2", so
        // we hang a symlink with that exact name in a writable dir and put it FIRST on the
        // search path. (Why this proot: process_vm_readv strips arm64 top-byte pointer tags,
        // avoiding the PEEKDATA "I/O error" on tagged addresses that broke the sandbox on
        // tag-enabled devices like the Solana Seeker. Full root cause: AndroidManifest.)
        val sonameShim = Paths.dir("${layout.filesDir}/proot-soname")
        val talloc2 = File(sonameShim, "libtalloc.so.2")
        val tallocTarget = "${layout.nativeLibDir}/libtalloc.so"
        // nativeLibDir changes on every (re)install, so a symlink left by a PRIOR install points
        // at a path that no longer exists. File.exists() follows the link → false for that stale
        // one, yet Os.symlink would then fail EEXIST (the link file is still there) and never get
        // recreated — leaving proot unable to resolve libtalloc.so.2 and the server stuck on boot
        // after every reinstall. Recreate whenever the link is missing OR doesn't already point at
        // the CURRENT target, so a fresh install / upgrade self-heals without manual intervention.
        val curTarget = runCatching { Os.readlink(talloc2.absolutePath) }.getOrNull()
        if (curTarget != tallocTarget) {
            runCatching {
                talloc2.delete() // drop any stale link/file before relinking
                Os.symlink(tallocTarget, talloc2.absolutePath)
            }.onFailure { Log.w(TAG, "could not create libtalloc.so.2 soname symlink", it) }
        }
        env["LD_LIBRARY_PATH"] =
            listOfNotNull(sonameShim.absolutePath, layout.nativeLibDir, env["LD_LIBRARY_PATH"])
                .joinToString(":")
        // PROOT_NO_SECCOMP: Android 12+/15 tighten the seccomp filter (e.g. set_robust_list
        // blocked), which makes glibc/node crash with SIGSYS under proot's seccomp fast
        // path. Turning seccomp off trades the speed win for "it runs at all" — necessary
        // on newer Android. (If a target kernel is fine with seccomp, dropping this would
        // be faster; that's an on-device measurement, see project memory.)
        // DO NOT set PROOT_NO_SECCOMP. It forces proot to ptrace-intercept and translate
        // EVERY syscall, including getcwd → readlink("/proc/self/cwd"). In the
        // untrusted_app SELinux domain /proc/<pid> is restricted, so that readlink fails
        // and getcwd returns ENOSYS — node then dies with `ENOSYS: uv_cwd` at startup
        // (the claude SDK calls process.cwd() at import time, before our server loads).
        // With seccomp acceleration ON (the default), getcwd runs natively in the kernel,
        // never touches /proc, and the server boots cleanly. Verified on-device: Samsung
        // SM-F711N (Snapdragon), Android 13 — server reaches HTTP 200, no SIGSYS.
        // (The earlier belief that newer Android needs NO_SECCOMP for set_robust_list was
        // wrong for this path; seccomp-on is both correct AND faster.)
        env["PROOT_TMP_DIR"] = Paths.dir("${layout.rootfs}/tmp").absolutePath
        env["PROOT_L2S_DIR"] = Paths.dir("${layout.rootfs}/.l2s").absolutePath // stable link2symlink db
        pb.redirectErrorStream(true)

        return pb.start()
    }

    // Build the proot invocation that enters the Ubuntu guest and runs `guestCommand` as a
    // login shell. Flags mirror proot-distro's defaults; --kill-on-exit ties guest
    // processes to ours so nothing is orphaned, --link2symlink is guest compatibility, and
    // /dev,/proc,/sys are bound through from Android.
    // We launch proot through a host /system/bin/sh that first `cd`s into filesDir, then
    // `exec`s proot. This is load-bearing: an Android app process has cwd = "/", which is
    // unreadable under SELinux, so proot's startup getcwd() fails ("sh: 0: getcwd()
    // failed") and a broken cwd propagates into the guest — node then dies with
    // `ENOSYS: uv_cwd` before our server loads. ProcessBuilder.directory() did NOT fix
    // this (proot still saw the inherited "/"); doing the chdir in the host shell, right
    // before exec, makes proot start from a readable cwd. The guest env + args are passed
    // verbatim to that shell as a single argv.
    private fun prootCommand(guestEnv: List<String>, guestCommand: String): List<String> {
        val guestArgv = listOf(
            layout.proot,
            "--kill-on-exit",
            "--link2symlink",           // app storage has no hardlinks; proot fakes them
            // NOTE: kept to flags the Termux proot build supports. --sysvipc is dropped
            // (node doesn't need SysV IPC). -L and --kernel-release are likewise omitted as
            // non-essential (add back only if a specific build is confirmed to accept them).
            "-r", layout.rootfs,
            "-0",                       // present as uid 0 inside the guest (fake root)
            "-b", "/dev",
            "-b", "/proc",
            "-b", "/sys",
            "-b", "${layout.rootfs}/tmp:/dev/shm", // Android has no /dev/shm; bind a guest tmp dir
            "-w", "/root",
            "/usr/bin/env", "-i",
            *guestEnv.toTypedArray(),
            "/bin/sh", "-lc", guestCommand,
        )
        // cd into a readable dir, then exec proot so it never inherits the unreadable "/".
        val inner = "cd " + shQuote(layout.filesDir) + " && exec " + guestArgv.joinToString(" ") { shQuote(it) }
        return listOf("/system/bin/sh", "-c", inner)
    }

    // POSIX single-quote escaping so paths/args with spaces or metacharacters survive the
    // host shell unmodified ( ' -> '\'' ).
    private fun shQuote(s: String): String = "'" + s.replace("'", "'\\''") + "'"
}
