package com.iqlabs.agentnet

import android.content.Context
import android.os.Build
import android.util.Log
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

// Runs our localhost node server INSIDE a proot-distro Ubuntu guest, then waits for it
// to answer on 127.0.0.1. This is the Android form of vscode's extension host: same
// node bundle, same HTTP-RPC + SSE transport, just launched through the guest so the glibc
// node + official claude/codex binaries run on Android.
//
// ServerManager owns WHAT runs (the node server command + its guest environment) and the
// process lifecycle (log draining, readiness poll, stop). HOW the guest is entered — the
// proot invocation, loader, seccomp policy, pointer-tag-safe libs — lives behind GuestExec
// (DirectProotExec today; a linker-routing strategy for modern targetSdk later).
class ServerManager(private val ctx: Context) {
    companion object {
        private const val TAG = "AgentNet/Server"
    }

    @Volatile private var process: Process? = null
    val isRunning: Boolean get() = process?.isAlive == true

    // The guest process environment passed to `env -i` inside the guest. This is the node
    // server's runtime config, independent of how the guest is entered.
    private fun buildGuestEnv(): List<String> {
        val googleClientIdEnv =
            if (BuildConfig.GOOGLE_OAUTH_CLIENT_ID.isBlank()) emptyList()
            else listOf("GOOGLE_CLIENT_ID=${BuildConfig.GOOGLE_OAUTH_CLIENT_ID}")
        val googleNativeAuthEnv = listOf(
            "GOOGLE_AUTHORIZE_URL=http://127.0.0.1:${Paths.GOOGLE_AUTH_PORT}/google-drive/authorize",
            "GOOGLE_ACCESS_TOKEN_URL=http://127.0.0.1:${Paths.GOOGLE_AUTH_PORT}/google-drive/token",
            "GOOGLE_AUTH_STATUS_URL=http://127.0.0.1:${Paths.GOOGLE_AUTH_PORT}/google-drive/status",
        )
        return listOf(
            "HOME=/root",
            "USER=root",
            "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/local/games:/usr/games",
            "TERM=xterm-256color",
            "LANG=C.UTF-8",
            "TMPDIR=/tmp",
            // Ubuntu 24.04's glibc (2.39) registers rseq for every thread, which proot's
            // ptrace emulation on Android kernels handles wrong — threaded workloads see
            // corrupted state. The visible casualty is `git index-pack` (multi-threaded
            // delta resolution), which makes EVERY `git clone` fail connectivity checks
            // ("remote did not send all necessary objects", issue #112). Same workaround
            // the Termux/proot-distro fleet uses for 24.04 guests. Set here so node and
            // every child it spawns (claude/codex/git) inherit it.
            "GLIBC_TUNABLES=glibc.pthread.rseq=0",
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
        ) + googleClientIdEnv + googleNativeAuthEnv
    }

    // Start node on our localhost bundle inside the guest. Returns once the process is
    // spawned; call waitForServer() to block until it actually serves.
    fun start(): Boolean {
        if (isRunning) {
            Log.i(TAG, "server already running")
            return true
        }
        val layout = Paths.layout(ctx)
        // `node` resolves from the guest PATH; the bundle is at /root/agentnet-server.
        val cmd = "exec node /root/agentnet-server/index.js"
        // One guest-launch seam. DirectProotExec is the only strategy today; a modern-targetSdk
        // strategy will add its selection here.
        val proc = DirectProotExec(layout).launch(buildGuestEnv(), cmd)
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
