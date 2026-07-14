package com.iqlabs.agentnet

import android.content.Context
import android.system.Os
import android.util.Log
import java.io.File

// #117 basement hardening: fake /proc content. Under untrusted_app, Android DENIES the app
// (and therefore the proot guest that inherits its SELinux domain) read access to a set of
// /proc files — proven on-device (SM-A356E): `cat /proc/loadavg` -> "Permission denied",
// same for /proc/version and /proc/sys/fs/inotify/max_user_watches. This breaks tools that
// read them: node os.loadavg()/os.cpus() (loadavg, stat), vite/chokidar & other inotify
// watchers (max_user_watches), capsh/apt (cap_last_cap), id-mapping (overflowuid/gid).
// proot-distro solves this by bind-mounting fake files ONLY where the real one is unreadable.
// We mirror that: Installer lays these down, DirectProotExec binds the unreadable ones.
// One list = the single source of truth for both. (realProcPath, fakeFileName, content)
// ponytail: /proc/vmstat is in proot-distro's set but has no consumer in our node/agent
// stack — skipped; add a row here if a tool ever needs it.
internal val FAKE_PROC: List<Triple<String, String, String>> = listOf(
    Triple("/proc/loadavg", "loadavg", "0.12 0.07 0.02 2/165 765\n"),
    Triple(
        "/proc/stat", "stat",
        // cpu + per-cpu lines: node os.cpus() parses cpu0..cpuN for CPU times. 8 cores.
        "cpu  1957 0 2877 93280 262 342 254 87 0 0\n" +
            "cpu0 31 0 226 12027 82 10 4 9 0 0\n" +
            "cpu1 45 0 664 11144 21 263 233 12 0 0\n" +
            "cpu2 494 0 537 11283 27 10 3 8 0 0\n" +
            "cpu3 359 0 234 11723 24 26 5 7 0 0\n" +
            "cpu4 295 0 268 11772 10 12 2 12 0 0\n" +
            "cpu5 270 0 251 11833 15 3 1 10 0 0\n" +
            "cpu6 430 0 520 11386 30 8 1 12 0 0\n" +
            "cpu7 30 0 172 12108 50 8 1 13 0 0\n" +
            "ctxt 140223\nbtime 1680020856\nprocesses 772\n" +
            "procs_running 2\nprocs_blocked 0\n",
    ),
    Triple("/proc/uptime", "uptime", "124.08 932.80\n"),
    Triple("/proc/version", "version", "Linux version 5.15.0-android13 (proot@agentnet) #1 SMP PREEMPT\n"),
    Triple("/proc/sys/kernel/cap_last_cap", "sysctl_cap_last_cap", "40\n"),
    Triple("/proc/sys/fs/inotify/max_user_watches", "sysctl_inotify_max_user_watches", "4096\n"),
    Triple("/proc/sys/kernel/overflowuid", "sysctl_overflowuid", "65534\n"),
    Triple("/proc/sys/kernel/overflowgid", "sysctl_overflowgid", "65534\n"),
)

// Directory (in the rootfs) holding the fake /proc files DirectProotExec binds from.
internal fun sysdataDir(rootfs: String): File = File(rootfs, ".sysdata")

// #117: /usr/local/bin/bun wrapper — makes `bun add/install` work under proot/untrusted_app.
// See Installer.writeBunWrapper for the why. Kept minimal; forwards everything else verbatim.
private val BUN_WRAPPER = """
#!/bin/sh
# AgentNet #117: bun under proot/untrusted_app needs two nudges (both proven on-device):
#  (1) it won't create node_modules itself ("ENOENT: could not open node_modules") -> pre-create.
#      This is unrelated to hardlinks, so --copy-on-link does NOT cover it — always needed.
#  (2) its default hardlink backend hits the kernel hardlink denial -> force --backend=copyfile.
# copyfile is belt-and-suspenders alongside PRoot's --copy-on-link (like git's core.createObject=
# rename in #116): it works whether or not the shipped PRoot is the patched build, so bun never
# regresses while a source-built binary is pending. Keeping it costs nothing (same result, bun
# just copies in userspace instead of PRoot copying on the EACCES).
case "${'$'}1" in
  add|install|i|update|remove|rm|link|unlink|ci)
    mkdir -p node_modules 2>/dev/null
    case " ${'$'}* " in *" --backend"*) : ;; *) set -- "${'$'}@" --backend=copyfile ;; esac
    ;;
esac
exec /usr/bin/bun "${'$'}@"
""".trimStart()

// First-run setup: lay down the Ubuntu rootfs and our server bundle into app storage.
// Idempotent — a marker file means "already installed", so this is a no-op on every
// launch after the first.
//
// proot itself is NOT installed here anymore: it ships under jniLibs (as libproot.so +
// libloader*.so + libtalloc.so/libandroid-shmem.so) and the OS extracts it into
// nativeLibraryDir at install time (see Paths). That keeps executable ELF out of assets/,
// which is what was tripping the Play Protect REJECT.
//
// What ships and is extracted HERE:
//   rootfs-<abi>.tar       — proot-distro Ubuntu (glibc) rootfs; claude/codex + node
//                            are installed into it (so they're real Linux binaries)
//   agentnet-server.tar    — our surfaces/localhost build output (the node bundle)
//
// The heavy artifacts are NOT in the repo (they're built/fetched by the release
// pipeline). This class is the extraction logic that runs when they're present.
class Installer(private val ctx: Context) {
    companion object {
        private const val TAG = "AgentNet/Installer"
        // Bumped v3 -> v5 (v4 skipped) to force a one-time rootfs re-extraction on existing
        // installs: issue #112's fix ships IN the rootfs (python3-dulwich + the git-clone shim
        // at /usr/local/bin/git — native git clone is corrupted by proot under targetSdk-35's
        // untrusted_app domain), so a server-bundle-only update is not enough. Marker bumps
        // are how heavy rootfs fixes reach devices: the MARKER only re-extracts on a fresh
        // marker, and the re-extract is from the bundled tar (no network download).
        private const val MARKER = ".installed-v5"
        // Server bundle is small and changes every app build; its marker holds the app's
        // versionCode so an APK update re-extracts ONLY the server bundle (the heavy
        // rootfs is left alone). Without this, the idempotent MARKER froze the server
        // code at first-install forever — surface fixes never reached the device.
        private const val SERVER_MARKER = ".server-version"
    }

    private fun abi(): String = when {
        android.os.Build.SUPPORTED_ABIS.any { it == "arm64-v8a" } -> "arm64"
        android.os.Build.SUPPORTED_ABIS.any { it == "x86_64" } -> "x86_64"
        else -> throw RuntimeException(
            "unsupported ABI: ${android.os.Build.SUPPORTED_ABIS.joinToString()}"
        )
    }

    fun isInstalled(): Boolean = File(ctx.filesDir, MARKER).exists()

    // Identity of the server bundle SHIPPED in this APK — a CRC32 over the asset bytes.
    // Content-based (not versionCode) so even unversioned dev rebuilds re-extract when
    // the bundle actually changed. ~8MB streamed at launch; cheap enough.
    private fun assetCrc(name: String): String {
        val crc = java.util.zip.CRC32()
        ctx.assets.open(name).use { input ->
            val buf = ByteArray(1 shl 16)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                crc.update(buf, 0, n)
            }
        }
        return crc.value.toString(16)
    }

    private fun serverUpToDate(crc: String): Boolean =
        File(ctx.filesDir, SERVER_MARKER).takeIf { it.exists() }?.readText() == crc

    // Re-extract ONLY the server bundle (cheap) over the existing one. Called when the
    // heavy rootfs is already installed but the APK shipped newer server code.
    private fun installServerBundle(p: Paths.Layout, crc: String) {
        val dir = File(p.serverBundle)
        if (dir.exists()) dir.deleteRecursively()
        Paths.dir(p.serverBundle)
        TarExtractor.extract(ctx.assets.open("agentnet-server.tar"), dir)
        File(ctx.filesDir, SERVER_MARKER).writeText(crc)
    }

    // Extract everything. onProgress reports a short status for the setup UI.
    fun install(onProgress: (String) -> Unit) {
        val p = Paths.layout(ctx)
        val serverCrc = assetCrc("agentnet-server.tar")
        if (isInstalled()) {
            // #115: reach devices that installed BEFORE this fix. configureGuest (below) only
            // runs on a fresh marker, so an APK update alone would leave existing rootfs without
            // /etc/gitconfig and git would stay broken. This write is idempotent + tiny, so do it
            // on every launch — far cheaper than a MARKER bump + full rootfs re-extract.
            writeGuestGitConfig(p)
            writeFakeSysdata(p) // #117: idempotent + tiny; every-launch so existing installs get it
            writeBunWrapper(p)
            // Heavy artifacts (proot + rootfs) are in place. But the server bundle changes
            // every build — refresh it if this APK shipped a different one.
            if (serverUpToDate(serverCrc)) {
                Log.i(TAG, "already installed")
            } else {
                Log.i(TAG, "updating server bundle ($serverCrc)")
                onProgress("Updating")
                installServerBundle(p, serverCrc)
                Log.i(TAG, "server bundle updated")
            }
            return
        }
        val abi = abi()

        // NOTE: proot is no longer extracted here. It ships under jniLibs and the OS lays
        // it down in nativeLibraryDir at install time (see Paths). First-run setup is just
        // the rootfs + the server bundle below.

        onProgress("Setting up your environment\nFirst launch only — this takes a few minutes")
        // rootfs is large; stream it to disk, then let the guest's tar unpack it. We
        // can't unpack the glibc rootfs with proot until proot exists — which it now
        // does — so we run `proot ... tar xJf` with a minimal busybox-free path. To
        // keep this dependency-free, we unpack with Android's own gzip/xz is not
        // available, so the rootfs ships as a plain tar (.tar) and we stream-untar it
        // in Kotlin before first proot use.
        val preservedHome = preserveGuestHome(p)
        File(p.rootfs).deleteRecursively()
        Paths.dir(p.rootfs)
        TarExtractor.extract(ctx.assets.open("rootfs-$abi.tar"), File(p.rootfs))
        restoreGuestHome(p, preservedHome)
        configureGuest(p) // DNS/hosts/tmp — Android doesn't provide these to the guest

        onProgress("Almost there")
        installServerBundle(p, serverCrc)

        File(ctx.filesDir, MARKER).writeText("ok")
        Log.i(TAG, "install complete")
    }

    private fun preserveGuestHome(p: Paths.Layout): File? {
        val home = File(p.home)
        val backup = File(ctx.filesDir, ".guest-home-backup")
        // If a previous install attempt died between the rootfs delete and restore, the
        // backup still holds the user's guest /root while home is gone — adopt it instead
        // of returning null, or that data would be orphaned forever.
        if (!home.exists()) return backup.takeIf { it.exists() }
        backup.deleteRecursively()
        if (home.renameTo(backup)) return backup
        return runCatching {
            home.copyRecursively(backup, overwrite = true)
            backup
        }.onFailure {
            Log.w(TAG, "could not preserve guest /root before rootfs replacement", it)
        }.getOrNull()
    }

    private fun restoreGuestHome(p: Paths.Layout, preservedHome: File?) {
        if (preservedHome == null || !preservedHome.exists()) return
        File(p.home).deleteRecursively()
        val home = File(p.home)
        if (!preservedHome.renameTo(home)) {
            runCatching {
                preservedHome.copyRecursively(home, overwrite = true)
                preservedHome.deleteRecursively()
            }.onFailure {
                Log.w(TAG, "could not restore preserved guest /root after rootfs replacement", it)
            }
        }
    }

    // Android exposes neither /etc/resolv.conf nor /etc/hosts to the proot guest, so
    // the agent CLIs' DNS lookups (to the model API) fail without these. proot-distro
    // writes the same files at install time. /tmp must exist + be world-writable since
    // we bind it to /dev/shm.
    private fun configureGuest(p: Paths.Layout) {
        File(p.rootfs, "etc").mkdirs()
        // Ubuntu ships /etc/resolv.conf as a SYMLINK (to systemd-resolved); writing over
        // the link would follow it to a missing/erroring target. Delete the link/file
        // first, then write a plain file. Same for /etc/hosts.
        writeFresh(File(p.rootfs, "etc/resolv.conf"), "nameserver 8.8.8.8\nnameserver 8.8.4.4\n")
        writeFresh(File(p.rootfs, "etc/hosts"), "127.0.0.1 localhost\n::1 localhost\n")
        writeGuestGitConfig(p)
        writeFakeSysdata(p)
        writeBunWrapper(p)
        val tmp = File(p.rootfs, "tmp").apply { mkdirs() }
        runCatching { android.system.Os.chmod(tmp.absolutePath, 0b001_111_111_111) } // 1777
    }

    // #115: under untrusted_app, proot's link() is a FALSE success — returns 0 but the target
    // file never appears (proven on-device: `link ret=0 target_exists_after=0`). git's default
    // loose-object finalize is mkstemp -> link(tmp,final) -> unlink(tmp); git trusts link's 0 and
    // reports the object written, so clone/commit/fetch silently lose objects ("remote did not
    // send all necessary objects" / "bad object"). core.createObject=rename makes git skip link()
    // and use rename(), which proot handles correctly (verified: 0/50 loose objects survive with
    // link, 50/50 with rename, real clone succeeds). System gitconfig so EVERY git — the server's
    // and the user's interactive shell — gets it. Supersedes the clone-only dulwich shim (#114);
    // the all-tools basement fix (patch proot's linkat) is tracked separately in #115.
    private fun writeGuestGitConfig(p: Paths.Layout) {
        runCatching { writeFresh(File(p.rootfs, "etc/gitconfig"), "[core]\n\tcreateObject = rename\n") }
            .onFailure { Log.w(TAG, "could not write guest /etc/gitconfig (#115 fix)", it) }
    }

    // #117: /usr/local/bin/bun wrapper (see BUN_WRAPPER for the two nudges + why). Pre-creates
    // node_modules (bun exits "ENOENT: could not open the node_modules directory" otherwise —
    // unrelated to hardlinks, so --copy-on-link doesn't cover it) and forces --backend=copyfile as
    // belt-and-suspenders alongside PRoot's --copy-on-link, so bun works even if an older (pre-
    // patch) android-assets artifact is reused. Every launch => reaches existing installs; skipped
    // if the guest has no /usr/bin/bun.
    private fun writeBunWrapper(p: Paths.Layout) {
        runCatching {
            if (!File(p.rootfs, "usr/bin/bun").exists()) return
            val wrapper = File(p.rootfs, "usr/local/bin/bun")
            writeFresh(wrapper, BUN_WRAPPER)
            Os.chmod(wrapper.absolutePath, 0b000_111_101_101) // 0755
        }.onFailure { Log.w(TAG, "could not write guest bun wrapper (#117)", it) }
    }

    // #117: write the fake /proc files (see FAKE_PROC). DirectProotExec binds them over the
    // real, denied /proc entries at launch. Idempotent — overwrite each launch so content
    // fixes reach existing installs without a rootfs re-extract.
    private fun writeFakeSysdata(p: Paths.Layout) {
        runCatching {
            val dir = sysdataDir(p.rootfs).apply { mkdirs() }
            for ((_, name, content) in FAKE_PROC) File(dir, name).writeText(content)
        }.onFailure { Log.w(TAG, "could not write fake /proc sysdata (#117 hardening)", it) }
    }

    // Write `text` to `file`, first removing any existing symlink/file at that path so
    // we never follow a dangling symlink (e.g. Ubuntu's /etc/resolv.conf link).
    private fun writeFresh(file: File, text: String) {
        runCatching { android.system.Os.remove(file.absolutePath) } // unlink (link or file)
        file.parentFile?.mkdirs()
        file.writeText(text)
    }
}
