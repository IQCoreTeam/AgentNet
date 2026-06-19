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
        val filesDir: String,   // app private root
        val proot: String,      // the proot binary (Bionic-native, runs on Android)
        val loader: String,     // proot's ELF loader FILE (PROOT_LOADER points here)
        val prootRoot: String,  // the extracted proot/ dir (bin/ + libexec/)
        val rootfs: String,     // the extracted Ubuntu glibc rootfs
        val home: String,       // $HOME inside the guest's view (under rootfs)
        val serverBundle: String, // our localhost bundle, copied into the rootfs
    )

    fun layout(ctx: Context): Layout {
        val files = ctx.filesDir.absolutePath
        return Layout(
            filesDir = files,
            prootRoot = "$files/proot",
            proot = "$files/proot/bin/proot",
            loader = "$files/proot/libexec/proot/loader",
            rootfs = "$files/rootfs",
            home = "$files/rootfs/root",
            serverBundle = "$files/rootfs/root/agentnet-server",
        )
    }

    fun dir(path: String): File = File(path).also { it.mkdirs() }
}
