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
//   proot-<abi>            — Bionic-native proot binary (runs on Android directly)
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
    }

    private fun abi(): String = when {
        android.os.Build.SUPPORTED_ABIS.any { it == "arm64-v8a" } -> "arm64"
        android.os.Build.SUPPORTED_ABIS.any { it == "x86_64" } -> "x86_64"
        else -> throw RuntimeException(
            "unsupported ABI: ${android.os.Build.SUPPORTED_ABIS.joinToString()}"
        )
    }

    fun isInstalled(): Boolean = File(ctx.filesDir, MARKER).exists()

    // Extract everything. onProgress reports a short status for the setup UI.
    fun install(onProgress: (String) -> Unit) {
        if (isInstalled()) {
            Log.i(TAG, "already installed")
            return
        }
        val p = Paths.layout(ctx)
        val abi = abi()

        onProgress("Unpacking runtime…")
        // proot binary: small, copy straight from assets and mark executable.
        copyAsset("proot-$abi", p.proot)
        Os.chmod(p.proot, 0b111_101_101) // 0755
        // proot's loader helper (some builds ship a separate ELF loader).
        runCatching { copyAsset("loader-$abi", p.loader); Os.chmod(p.loader, 0b111_101_101) }

        onProgress("Installing Linux environment… (one time, a few minutes)")
        // rootfs is large; stream it to disk, then let the guest's tar unpack it. We
        // can't unpack the glibc rootfs with proot until proot exists — which it now
        // does — so we run `proot ... tar xJf` with a minimal busybox-free path. To
        // keep this dependency-free, we unpack with Android's own gzip/xz is not
        // available, so the rootfs ships as a plain tar (.tar) and we stream-untar it
        // in Kotlin before first proot use.
        Paths.dir(p.rootfs)
        TarExtractor.extract(ctx.assets.open("rootfs-$abi.tar"), File(p.rootfs))

        onProgress("Installing AgentNet server…")
        Paths.dir(p.serverBundle)
        TarExtractor.extract(ctx.assets.open("agentnet-server.tar"), File(p.serverBundle))

        File(ctx.filesDir, MARKER).writeText("ok")
        Log.i(TAG, "install complete")
    }

    private fun copyAsset(name: String, destPath: String) {
        val dest = File(destPath)
        dest.parentFile?.mkdirs()
        ctx.assets.open(name).use { input ->
            FileOutputStream(dest).use { output -> input.copyTo(output) }
        }
    }
}
