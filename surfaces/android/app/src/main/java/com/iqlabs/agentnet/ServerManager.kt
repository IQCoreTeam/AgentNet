package com.iqlabs.agentnet

import android.content.Context
import android.os.Build
import android.system.Os
import android.util.Log
import java.io.BufferedReader
import java.io.File
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
        val googleClientIdEnv =
            if (BuildConfig.GOOGLE_OAUTH_CLIENT_ID.isBlank()) emptyList()
            else listOf("GOOGLE_CLIENT_ID=${BuildConfig.GOOGLE_OAUTH_CLIENT_ID}")
        val googleNativeAuthEnv = listOf(
            "GOOGLE_AUTHORIZE_URL=http://127.0.0.1:${Paths.GOOGLE_AUTH_PORT}/google-drive/authorize",
            "GOOGLE_ACCESS_TOKEN_URL=http://127.0.0.1:${Paths.GOOGLE_AUTH_PORT}/google-drive/token",
            "GOOGLE_AUTH_STATUS_URL=http://127.0.0.1:${Paths.GOOGLE_AUTH_PORT}/google-drive/status",
        )
        val guestArgv = listOf(
            p.proot,
            "--kill-on-exit",
            "--link2symlink",           // app storage has no hardlinks; proot fakes them
            // NOTE: kept to flags the Termux proot build supports. --sysvipc is dropped
            // (node doesn't need SysV IPC). -L and --kernel-release are likewise omitted as
            // non-essential (add back only if a specific build is confirmed to accept them).
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
            // Codex's OS-level sandbox uses bubblewrap, which needs Linux namespaces that
            // don't exist inside proot (proot is itself a ptrace fake-chroot for exactly
            // that reason). So bubblewrap can't run here — installing it wouldn't help.
            // proot + the Android app sandbox + our approval gate already isolate the guest,
            // so we tell Codex to skip its own sandbox. Desktop never sets this and keeps
            // its real sandbox. spawn.ts reads this and passes it as the Codex sandboxMode.
            "AGENTNET_CODEX_SANDBOX=danger-full-access",
            // Codex plugin discovery/sync is very file-system heavy under proot and can delay
            // the first model request by ~90s on Android. Local skills live under .codex/skills;
            // this only disables the Codex "plugins" feature for the Android app-server.
            "AGENTNET_CODEX_DISABLE_PLUGINS=1",
            "AGENTNET_DEVICE_LABEL=${Build.MANUFACTURER} ${Build.MODEL} (Android)",
            *googleClientIdEnv.toTypedArray(),
            *googleNativeAuthEnv.toTypedArray(),
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
        env["PROOT_LOADER_32"] = p.loader32       // 32-bit loader (guest is 64-bit; set anyway)
        // proot is the Termux build (process_vm=yes), dynamically linked against
        // libtalloc.so.2 + libandroid-shmem.so. Those now ship under jniLibs and the OS
        // extracts them into nativeLibraryDir — so point LD_LIBRARY_PATH there. jniLibs only
        // packages files named lib*.so, so the versioned libtalloc.so.2 had to ship as
        // libtalloc.so; but proot's DT_NEEDED still asks for the soname "libtalloc.so.2", so
        // we hang a symlink with that exact name in a writable dir and put it FIRST on the
        // search path. (Why this proot: process_vm_readv strips arm64 top-byte pointer tags,
        // avoiding the PEEKDATA "I/O error" on tagged addresses that broke the sandbox on
        // tag-enabled devices like the Solana Seeker. Full root cause: AndroidManifest.)
        val sonameShim = Paths.dir("${p.filesDir}/proot-soname")
        val talloc2 = File(sonameShim, "libtalloc.so.2")
        val tallocTarget = "${p.nativeLibDir}/libtalloc.so"
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
            listOfNotNull(sonameShim.absolutePath, p.nativeLibDir, env["LD_LIBRARY_PATH"])
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
        env["PROOT_TMP_DIR"] = Paths.dir("${p.rootfs}/tmp").absolutePath
        env["PROOT_L2S_DIR"] = Paths.dir("${p.rootfs}/.l2s").absolutePath // stable link2symlink db
        pb.redirectErrorStream(true)

        val proc = pb.start()
        process = proc

        // Drain stdout/stderr to logcat so server errors are visible (otherwise a
        // crash would be silent and the WebView would hang on a server that never came up).
        Thread {
            try {
                BufferedReader(InputStreamReader(proc.inputStream)).useLines { lines ->
                    // Info, not Debug: many retail ROMs drop app debug logs, which made this
                    // drain (the only window into the proot node server) silently invisible.
                    lines.forEach { Log.i(TAG, "[server] $it") }
                }
            } catch (e: Exception) {
                if (proc.isAlive) Log.w(TAG, "server log stream ended unexpectedly", e)
            } finally {
                val exit = runCatching { proc.waitFor() }.getOrNull()
                Log.i(TAG, "server process exited: ${exit ?: "unknown"}")
            }
        }.start()
        return true
    }

    fun stop() {
        val proc = process ?: return
        process = null
        // process.destroy() only SIGKILLs the DIRECT child (the host sh that exec'd into
        // proot). proot's guest `node` is a separate child — under SIGKILL proot never runs
        // its --kill-on-exit cleanup, so node ORPHANS (reparents to init) and keeps LISTENing
        // on 127.0.0.1:PORT. The next start() (a warm restart after the user backed out but
        // the app process survived) then dies with EADDRINUSE and the app talks to a zombie
        // server — the "doesn't recognize me" after a back/reopen. (force-stop avoided this by
        // killing the whole UID at once.) We can't group-kill: app/proot/node all share the
        // Zygote process group (PGID == zygote), so `kill -- -pgid` would take down our own
        // app. Instead walk /proc for every descendant of THIS app process (proot → node →
        // agent CLIs are our only forked subtree) and SIGKILL each — all same-UID, so allowed.
        val self = android.os.Process.myPid()
        val tree = descendantTree(self).filter { it != self }
        for (pid in tree) runCatching { android.os.Process.killProcess(pid) } // SIGKILL
        Log.i(TAG, "[server] stop() killed guest tree: $tree")
        proc.destroy() // backstop for the direct child
    }

    // BFS /proc for `root` and every descendant. /proc/<pid>/stat is "pid (comm) state ppid …";
    // comm can hold spaces/parens, so read ppid from after the last ") ". Snapshotting the
    // whole table once and walking it in memory avoids races as processes exit underfoot.
    private fun descendantTree(root: Int): List<Int> {
        val ppidOf = HashMap<Int, Int>()
        File("/proc").listFiles()?.forEach { d ->
            val pid = d.name.toIntOrNull() ?: return@forEach
            val stat = runCatching { File(d, "stat").readText() }.getOrNull() ?: return@forEach
            val ppid = stat.substringAfterLast(") ").split(" ").getOrNull(1)?.toIntOrNull()
                ?: return@forEach
            ppidOf[pid] = ppid
        }
        val out = mutableListOf(root)
        var i = 0
        while (i < out.size) {
            val parent = out[i++]
            for ((pid, ppid) in ppidOf) if (ppid == parent && pid !in out) out.add(pid)
        }
        return out
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
