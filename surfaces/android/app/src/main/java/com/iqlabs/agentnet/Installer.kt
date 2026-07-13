package com.iqlabs.agentnet

import android.content.Context
import android.system.Os
import android.util.Log
import java.io.File

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

    // Write `text` to `file`, first removing any existing symlink/file at that path so
    // we never follow a dangling symlink (e.g. Ubuntu's /etc/resolv.conf link).
    private fun writeFresh(file: File, text: String) {
        runCatching { android.system.Os.remove(file.absolutePath) } // unlink (link or file)
        file.parentFile?.mkdirs()
        file.writeText(text)
    }
}
