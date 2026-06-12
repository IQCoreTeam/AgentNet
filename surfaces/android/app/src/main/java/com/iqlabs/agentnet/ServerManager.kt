package com.iqlabs.agentnet

import android.content.Context
import android.util.Log
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

// Runs our localhost node server INSIDE a proot-distro Ubuntu guest, then waits for it
// to answer on 127.0.0.1. This is the Android form of vscode's extension host: same
// node bundle, same HTTP-RPC + SSE transport, just launched through proot so the glibc
// node + official claude/codex binaries run on Android.
//
// proot (not the agent) is what makes glibc binaries work here: it ptrace-remaps the
// guest's "/lib, /usr, /etc" onto the rootfs in app storage, so node/claude/codex see
// a normal Linux. seccomp acceleration is LEFT ON (we never set PROOT_NO_SECCOMP) —
// that keeps the per-syscall overhead small, which is why an agent's network-bound
// chat workload feels fine despite proot.
//
// Mechanics (ProcessBuilder + bg log thread + HTTP readiness poll) adapted from
// AnyClaw (friuns2/openclaw-android-assistant, MIT). The OpenClaw/Codex-specific
// install steps are NOT copied — our engine is the official CLIs in the proot guest.
class ServerManager(private val ctx: Context) {
    companion object {
        private const val TAG = "AgentNet/Server"
    }

    @Volatile private var process: Process? = null
    val isRunning: Boolean get() = process?.isAlive == true

    // Build the proot invocation that enters the Ubuntu guest and runs `cmd` as a
    // login shell. Flags mirror proot-distro's defaults; --kill-on-exit ties guest
    // processes to ours so nothing is orphaned, --link2symlink/--sysvipc are guest
    // compatibility, and /dev,/proc,/sys are bound through from Android.
    // We launch proot through a host /system/bin/sh that first `cd`s into filesDir, then
    // `exec`s proot. This is load-bearing: an Android app process has cwd = "/", which is
    // unreadable under SELinux, so proot's startup getcwd() fails ("sh: 0: getcwd()
    // failed") and a broken cwd propagates into the guest — node then dies with
    // `ENOSYS: uv_cwd` before our server loads. ProcessBuilder.directory() did NOT fix
    // this (proot still saw the inherited "/"); doing the chdir in the host shell, right
    // before exec, makes proot start from a readable cwd. The guest args are passed
    // verbatim to that shell as a single argv.
    private fun prootCommand(p: Paths.Layout, cmd: String): List<String> {
        val guestArgv = listOf(
            p.proot,
            "--kill-on-exit",
            "--link2symlink",           // app storage has no hardlinks; proot fakes them
            // NOTE: kept to flags the green-green-avk proot build supports. --sysvipc is NOT
            // one of them ("unknown option" → exit 1), and node doesn't need SysV IPC, so
            // it's dropped. -L and --kernel-release are likewise omitted as non-essential
            // (add back only if a specific build is confirmed to accept them).
            "-r", p.rootfs,
            "-0",                       // present as uid 0 inside the guest (fake root)
            "-b", "/dev",
            "-b", "/proc",
            "-b", "/sys",
            "-b", "${p.rootfs}/tmp:/dev/shm", // Android has no /dev/shm; bind a guest tmp dir
            "-w", "/root",
            "/usr/bin/env", "-i",
            "HOME=/root",
            "USER=root",
            "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/local/games:/usr/games",
            "TERM=xterm-256color",
            "LANG=C.UTF-8",
            "TMPDIR=/tmp",
            "AGENTNET_PORT=${Paths.PORT}",
            // the React SPA ships alongside the server bundle (build-assets.sh packs it at
            // ./webview); point the host at it so it serves the real UI, not the fallback.
            "AGENTNET_WEBVIEW_DIR=/root/agentnet-server/webview",
            "/bin/sh", "-lc", cmd,
        )
        // cd into a readable dir, then exec proot so it never inherits the unreadable "/".
        val inner = "cd " + shQuote(p.filesDir) + " && exec " + guestArgv.joinToString(" ") { shQuote(it) }
        return listOf("/system/bin/sh", "-c", inner)
    }

    // POSIX single-quote escaping so paths/args with spaces or metacharacters survive the
    // host shell unmodified ( ' -> '\'' ).
    private fun shQuote(s: String): String = "'" + s.replace("'", "'\\''") + "'"

    // Start node on our localhost bundle inside the guest. Returns once the process is
    // spawned; call waitForServer() to block until it actually serves.
    fun start(): Boolean {
        if (isRunning) {
            Log.i(TAG, "server already running")
            return true
        }
        val p = Paths.layout(ctx)
        // `node` resolves from the guest PATH; the bundle is at /root/agentnet-server.
        val cmd = "exec node /root/agentnet-server/index.js"
        // prootCommand wraps the launch in `sh -c 'cd <filesDir> && exec proot …'`, so the
        // host cwd is already pinned to a readable dir before proot runs (see the comment
        // there). That's what stops the `getcwd() failed → ENOSYS: uv_cwd` crash.
        val pb = ProcessBuilder(prootCommand(p, cmd))

        // Host-side env for the proot PROCESS (not the guest). These are load-bearing:
        val env = pb.environment()
        env["PROOT_LOADER"] = p.loader            // proot's own ELF loader helper
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
        env["PROOT_TMP_DIR"] = Paths.dir("${p.rootfs}/tmp").absolutePath
        env["PROOT_L2S_DIR"] = Paths.dir("${p.rootfs}/.l2s").absolutePath // stable link2symlink db
        pb.redirectErrorStream(true)

        val proc = pb.start()
        process = proc

        // Drain stdout/stderr to logcat so server errors are visible (otherwise a
        // crash would be silent and the WebView would hang on a server that never came up).
        Thread {
            BufferedReader(InputStreamReader(proc.inputStream)).useLines { lines ->
                lines.forEach { Log.d(TAG, "[server] $it") }
            }
            Log.i(TAG, "server process exited: ${proc.waitFor()}")
        }.start()
        return true
    }

    fun stop() {
        process?.destroy()
        process = null
    }

    // Poll http://127.0.0.1:PORT/onboarding until it answers (server up) or we time out.
    // HTTP polling, not a fixed sleep, so we show the WebView the instant it's ready.
    fun waitForServer(timeoutMs: Long = 120_000): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        val url = URL("http://127.0.0.1:${Paths.PORT}/onboarding")
        while (System.currentTimeMillis() < deadline) {
            try {
                val conn = url.openConnection() as HttpURLConnection
                conn.connectTimeout = 2000
                conn.readTimeout = 2000
                conn.requestMethod = "GET"
                val code = conn.responseCode
                conn.disconnect()
                if (code in 200..399) {
                    Log.i(TAG, "server ready (HTTP $code)")
                    return true
                }
            } catch (_: Exception) {
                // not up yet
            }
            Thread.sleep(500)
        }
        Log.e(TAG, "server did not become ready in ${timeoutMs}ms")
        return false
    }
}
