package com.iqlabs.agentnet

import android.content.Context
import android.system.Os
import android.util.Log
import java.io.File
import java.io.FileOutputStream

// First-run setup: lay down the proot binary, the Ubuntu rootfs, and our server bundle
// into app storage. Idempotent — a marker file means "already installed", so this is a
// no-op on every launch after the first.
//
// What ships in assets (prepared by scripts/, see README):
//   proot-<abi>/           — Bionic-native proot tree (bin/proot + libexec/proot/loader)
//   rootfs-<abi>.tar.xz    — proot-distro Ubuntu (glibc) rootfs; claude/codex + node
//                            are installed into it (so they're real Linux binaries)
//   agentnet-server.tar    — our surfaces/localhost build output (the node bundle)
//
// The heavy artifacts are NOT in the repo (they're built/fetched by the release
// pipeline). This class is the extraction logic that runs when they're present;
// extractTar* shells out to the guest's own tar AFTER proot is in place for the rootfs,
// and uses a pure-Kotlin copy for the small proot binary.
class Installer(private val ctx: Context) {
    companion object {
        private const val TAG = "AgentNet/Installer"
        private const val MARKER = ".installed-v1"
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

        onProgress("Preparing your runtime")
        // proot ships as a small dir tree in assets (proot-<abi>/bin/proot +
        // proot-<abi>/libexec/proot/loader). Copy the whole tree to filesDir/proot and
        // mark the binary + loaders executable.
        copyAssetDir("proot-$abi", p.prootRoot)
        Os.chmod(p.proot, 0b111_101_101) // 0755
        Os.chmod(p.loader, 0b111_101_101)
        runCatching { Os.chmod("${p.loader}32", 0b111_101_101) } // loader32, if present

        onProgress("Setting up your environment\nFirst launch only — this takes a few minutes")
        // rootfs is large; stream it to disk, then let the guest's tar unpack it. We
        // can't unpack the glibc rootfs with proot until proot exists — which it now
        // does — so we run `proot ... tar xJf` with a minimal busybox-free path. To
        // keep this dependency-free, we unpack with Android's own gzip/xz is not
        // available, so the rootfs ships as a plain tar (.tar) and we stream-untar it
        // in Kotlin before first proot use.
        Paths.dir(p.rootfs)
        TarExtractor.extract(ctx.assets.open("rootfs-$abi.tar"), File(p.rootfs))
        configureGuest(p) // DNS/hosts/tmp — Android doesn't provide these to the guest

        onProgress("Almost there")
        installServerBundle(p, serverCrc)

        File(ctx.filesDir, MARKER).writeText("ok")
        Log.i(TAG, "install complete")
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
        val tmp = File(p.rootfs, "tmp").apply { mkdirs() }
        runCatching { android.system.Os.chmod(tmp.absolutePath, 0b001_111_111_111) } // 1777
    }

    // Write `text` to `file`, first removing any existing symlink/file at that path so
    // we never follow a dangling symlink (e.g. Ubuntu's /etc/resolv.conf link).
    private fun writeFresh(file: File, text: String) {
        runCatching { android.system.Os.remove(file.absolutePath) } // unlink (link or file)
        file.parentFile?.mkdirs()
        file.writeText(text)
    }

    // Recursively copy an assets/ subtree to a destination dir. assets.list(path)
    // returns child names; a leaf (empty list) is a file, a node has children.
    private fun copyAssetDir(assetPath: String, destPath: String) {
        val children = ctx.assets.list(assetPath) ?: emptyArray()
        if (children.isEmpty()) { // file
            val dest = File(destPath)
            dest.parentFile?.mkdirs()
            ctx.assets.open(assetPath).use { input ->
                FileOutputStream(dest).use { output -> input.copyTo(output) }
            }
            return
        }
        File(destPath).mkdirs()
        for (child in children) copyAssetDir("$assetPath/$child", "$destPath/$child")
    }
}
