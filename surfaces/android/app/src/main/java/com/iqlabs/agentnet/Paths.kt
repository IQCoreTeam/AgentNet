package com.iqlabs.agentnet

import android.content.Context
import java.io.File

// On-device layout. Everything lives under the app's private files dir (no root, no
// shared storage). The proot guest is a glibc Ubuntu rootfs; the node bundle + agent
// CLIs are installed INSIDE it, so the official claude/codex binaries see a normal
// Linux (glibc, /lib, /usr) and run unmodified — the whole reason we use proot.
object Paths {
    const val PORT = 4317 // matches surfaces/localhost's default (AGENTNET_PORT)
    const val GOOGLE_AUTH_PORT = 4318 // Android-native Drive token bridge for the guest

    data class Layout(
        val filesDir: String,     // app private root
        val nativeLibDir: String, // OS-extracted native lib dir (holds libproot.so + libs)
        val proot: String,        // the proot binary (ships as jniLibs/<abi>/libproot.so)
        val loader: String,       // proot's ELF loader (jniLibs libloader.so; PROOT_LOADER)
        val loader32: String,     // 32-bit loader (libloader32.so; PROOT_LOADER_32)
        val rootfs: String,       // the extracted Ubuntu glibc rootfs
        val home: String,         // $HOME inside the guest's view (under rootfs)
        val serverBundle: String, // our localhost bundle, copied into the rootfs
    )

    fun layout(ctx: Context): Layout {
        val files = ctx.filesDir.absolutePath
        // proot + its loader/libs ship under jniLibs, and the OS extracts them into
        // nativeLibraryDir at install. That's the one app-owned dir that stays executable
        // regardless of targetSdk, and ELF under lib/ is what Play Protect expects — so
        // shipping proot here (not as loose ELF in assets/) avoids the "executable ELF in
        // assets" Play Protect REJECT. (The rootfs's OWN binaries still run via proot from
        // app storage, so targetSdk=28 is still required — this move doesn't change that.)
        val nativeLib = ctx.applicationInfo.nativeLibraryDir
        return Layout(
            filesDir = files,
            nativeLibDir = nativeLib,
            proot = "$nativeLib/libproot.so",
            loader = "$nativeLib/libloader.so",
            loader32 = "$nativeLib/libloader32.so",
            rootfs = "$files/rootfs",
            home = "$files/rootfs/root",
            serverBundle = "$files/rootfs/root/agentnet-server",
        )
    }

    fun dir(path: String): File = File(path).also { it.mkdirs() }
}
