package com.iqlabs.agentnet

import android.os.Process as OsProcess
import java.io.File

// T0 probe (issue #115). Answers the ONE question the whole native-exec refactor is gated on:
// can a glibc rootfs binary run as a native Android process — no proot, no ptrace — from the
// untrusted_app SELinux domain? proot's ptrace layer is what corrupts pipe/socket streams
// (truncated git pack, TLS decode fails); if the engine binaries run natively we delete that
// bug class. But glibc-under-Android is unproven, so we MEASURE it on-device before building
// T1+. This file only measures — it changes nothing in the shipping proot path.
//
// The technique (studied from termux-play-store/termux-apps, GPLv3 — re-implemented, not
// copied; the ONLY thing we may vendor is termux-exec/Apache-2.0, and not until T2): Android
// blocks execve() of a file in app storage under the targetSdk W^X policy, but it lets you
// execve() /system/bin/linker64 and pass your ELF as an argument — the system linker mmaps and
// runs it, no execve of the app-storage file. Two routes to try for a glibc binary:
//
//   Route B (glibc's own loader): linker64 loads glibc's ld-linux, which then loads the binary
//     with full glibc semantics. Bionic only bootstraps ld.so. The route that should work for a
//     glibc rootfs.
//   Route A (direct, termux-style): linker64 loads the glibc binary itself, resolving libc.so.6
//     from LD_LIBRARY_PATH. Mixes bionic-linker + glibc libc — fragile, but termux's route, so
//     we test it too and report which (if either) each device accepts.
object NativeProbe {
    const val TAG = "AgentNet/Probe"
    private const val LINKER64 = "/system/bin/linker64"
    private const val RUN_TIMEOUT_MS = 20_000L

    // What we found for one binary on one route.
    data class RunResult(
        val ok: Boolean,
        val exit: Int?,      // null = timed out / never exited
        val firstLine: String, // first non-blank line of merged stdout+stderr (the signal)
    )

    data class TargetReport(
        val name: String,
        val resolvedPath: String?, // null = not found in the rootfs
        val kind: Kind,
        val routeB: RunResult?,    // glibc ld.so via linker64 (null if not applicable/found)
        val routeA: RunResult?,    // direct binary via linker64 (ELF only; null for scripts)
    )

    enum class Kind { ELF, SCRIPT, MISSING }

    // Whole-sweep result: preflight (why a route COULD fail for boring reasons) + per-binary runs.
    data class Report(val preflight: String, val targets: List<TargetReport>)

    // Derived rootfs layout. Standard Ubuntu arm64 locations; resolved lazily against what
    // actually exists so we don't hardcode a layout the rootfs build might change.
    class Layout(rootfs: String) {
        val ldSo = "$rootfs/lib/ld-linux-aarch64.so.1"
        val libraryPath = listOf(
            "$rootfs/lib/aarch64-linux-gnu",
            "$rootfs/usr/lib/aarch64-linux-gnu",
            "$rootfs/lib",
            "$rootfs/usr/lib",
            "$rootfs/usr/local/lib",
        ).joinToString(":")
        // Where CLIs land in the guest. First existing hit wins.
        private val binDirs = listOf(
            "$rootfs/usr/local/bin", "$rootfs/usr/bin", "$rootfs/bin",
            "$rootfs/root/.local/bin", "$rootfs/root/.npm-global/bin",
        )

        fun resolve(name: String): String? =
            binDirs.map { "$it/$name" }.firstOrNull { File(it).exists() }

        val libDirs: List<String> get() = libraryPath.split(":")
    }

    // Route-B preconditions. If any of these are absent, a route-B FAIL is a boring missing-file
    // problem, NOT "bionic rejects glibc" — the distinction decides whether native exec is dead
    // or just mis-pathed. Route A only needs the binary + libs on LD_LIBRARY_PATH.
    private fun preflight(rootfs: String, lo: Layout): String = buildString {
        fun mark(ok: Boolean) = if (ok) "OK  " else "MISS"
        val abi = android.os.Build.SUPPORTED_ABIS.joinToString(",")
        appendLine("--- preflight ---")
        appendLine("app abi        : $abi")
        appendLine("${mark(File(LINKER64).exists())} $LINKER64")
        appendLine("${mark(File(rootfs).isDirectory)} rootfs $rootfs")
        appendLine("${mark(File(lo.ldSo).exists())} ld.so  ${lo.ldSo}   (route B needs this)")
        for (d in lo.libDirs) appendLine("${mark(File(d).isDirectory)} lib    $d")
    }

    // ── argv builders (pure — the testable core; see selfCheck) ─────────────────────────

    // Route B: bionic linker64 → glibc ld.so → binary. For a SCRIPT target, `binary` is node
    // and the script path rides as the next arg (a node CLI is just node + its JS entry).
    fun routeBArgv(lo: Layout, binary: String, args: List<String>): List<String> =
        listOf(LINKER64, lo.ldSo, "--library-path", lo.libraryPath, binary) + args

    // Route A: bionic linker64 → glibc binary directly (libc.so.6 via LD_LIBRARY_PATH env).
    fun routeAArgv(binary: String, args: List<String>): List<String> =
        listOf(LINKER64, binary) + args

    // ── execution ───────────────────────────────────────────────────────────────────────

    private fun run(argv: List<String>, extraEnv: Map<String, String>): RunResult {
        val pb = ProcessBuilder(argv).redirectErrorStream(true)
        pb.environment().putAll(extraEnv)
        return try {
            val p = pb.start()
            val out = p.inputStream.bufferedReader()
            // Drain on a thread so a chatty/blocking child can't deadlock the pipe while we wait.
            var firstLine = ""
            val drain = Thread {
                out.forEachLine { if (firstLine.isEmpty() && it.isNotBlank()) firstLine = it.trim() }
            }.apply { start() }
            val exited = p.waitFor(RUN_TIMEOUT_MS, java.util.concurrent.TimeUnit.MILLISECONDS)
            if (!exited) {
                p.destroyForcibly()
                drain.join(1000)
                return RunResult(false, null, firstLine.ifEmpty { "(timeout, no output)" })
            }
            drain.join(1000)
            val code = p.exitValue()
            RunResult(code == 0, code, firstLine.ifEmpty { "(no output)" })
        } catch (e: Exception) {
            // Most-telling failure lands here: UnsupportedOperationException / IOException
            // "Permission denied" (W^X) or the child's "CANNOT LINK EXECUTABLE".
            RunResult(false, null, (e.message ?: e.javaClass.simpleName).take(200))
        }
    }

    // Classify by magic bytes: ELF, shebang script, or unreadable.
    private fun kindOf(path: String): Kind = runCatching {
        File(path).inputStream().use { s ->
            val b = ByteArray(4); val n = s.read(b)
            when {
                n >= 4 && b[0] == 0x7f.toByte() && b[1] == 'E'.code.toByte() &&
                    b[2] == 'L'.code.toByte() && b[3] == 'F'.code.toByte() -> Kind.ELF
                n >= 2 && b[0] == '#'.code.toByte() && b[1] == '!'.code.toByte() -> Kind.SCRIPT
                else -> Kind.ELF // no shebang, not obviously text → treat as ELF and let the run decide
            }
        }
    }.getOrDefault(Kind.MISSING)

    // Probe one binary. `versionArgs` is a cheap invocation that proves it ran (e.g. --version).
    private fun probeOne(lo: Layout, name: String, versionArgs: List<String>, nodePath: String?): TargetReport {
        val path = lo.resolve(name) ?: return TargetReport(name, null, Kind.MISSING, null, null)
        val env = mapOf("LD_LIBRARY_PATH" to lo.libraryPath, "HOME" to "/root")
        return when (kindOf(path)) {
            Kind.ELF -> TargetReport(
                name, path, Kind.ELF,
                routeB = run(routeBArgv(lo, path, versionArgs), env),
                routeA = run(routeAArgv(path, versionArgs), env),
            )
            Kind.SCRIPT -> {
                // A node CLI (claude/codex): native viability == node's. Run it THROUGH node
                // via route B; route A is meaningless for a script.
                val rb = nodePath?.let { run(routeBArgv(lo, it, listOf(path) + versionArgs), env) }
                TargetReport(name, path, Kind.SCRIPT, rb, null)
            }
            Kind.MISSING -> TargetReport(name, path, Kind.MISSING, null, null)
        }
    }

    // Full T0 sweep. `rootfs` is Paths.Layout.rootfs. Runs off the UI thread (callers already do).
    fun sweep(rootfs: String): Report {
        val lo = Layout(rootfs)
        val node = lo.resolve("node")
        val specs = listOf(
            "node" to listOf("--version"),
            "git" to listOf("--version"),
            "claude" to listOf("--version"),
            "codex" to listOf("--version"),
            // DNS under native exec (no proot, no /etc redirect yet). glibc getaddrinfo reads
            // /etc/resolv.conf at a HARDCODED path — Android has none, so this is expected to
            // FAIL until the T2 redirect shim provides one. A fail here localizes the DNS problem
            // to exactly that shim; a pass would mean the device resolves without it.
            "getent" to listOf("hosts", "api.anthropic.com"),
        )
        return Report(preflight(rootfs, lo), specs.map { (n, args) -> probeOne(lo, n, args, node) })
    }

    // Human-readable report for the screen / logcat.
    fun format(report: Report): String = buildString {
        appendLine("=== T0 native-exec probe ===")
        appendLine("pid=${OsProcess.myPid()} uid=${OsProcess.myUid()} (untrusted_app domain)")
        appendLine(report.preflight)
        appendLine()
        for (r in report.targets) {
            appendLine("• ${r.name}  [${r.kind}]  ${r.resolvedPath ?: "NOT FOUND in rootfs"}")
            r.routeB?.let { appendLine("    route B (glibc ld.so): ${verdict(it)}") }
            r.routeA?.let { appendLine("    route A (direct)     : ${verdict(it)}") }
            if (r.kind == Kind.SCRIPT) appendLine("    (node CLI — viability follows node's route B)")
            appendLine()
        }
        appendLine("Legend: OK = exit 0. A FAIL with \"CANNOT LINK\" = bionic rejected glibc.")
        appendLine("getent FAIL is expected pre-shim (no /etc/resolv.conf) — that's the T2 signal.")
    }

    private fun verdict(r: RunResult): String {
        val tag = if (r.ok) "OK" else "FAIL"
        val ex = r.exit?.toString() ?: "timeout"
        return "$tag (exit=$ex) \"${r.firstLine}\""
    }

    // ponytail: one runnable check for the non-trivial part — the argv shape. Wrong argv order
    // (linker/ld.so/--library-path/binary) is the whole ballgame; catch a regression loudly.
    // Called at screen open; logs pass/fail.
    fun selfCheck(): Boolean {
        val lo = Layout("/RF")
        val b = routeBArgv(lo, "/RF/usr/bin/git", listOf("--version"))
        val a = routeAArgv("/RF/usr/bin/git", listOf("--version"))
        check(b == listOf(LINKER64, "/RF/lib/ld-linux-aarch64.so.1", "--library-path",
            lo.libraryPath, "/RF/usr/bin/git", "--version")) { "routeB argv shape drifted: $b" }
        check(a == listOf(LINKER64, "/RF/usr/bin/git", "--version")) { "routeA argv shape drifted: $a" }
        check(lo.libraryPath.startsWith("/RF/lib/aarch64-linux-gnu")) { "libpath order drifted" }
        return true
    }
}
