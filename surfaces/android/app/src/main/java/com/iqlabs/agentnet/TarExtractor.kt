package com.iqlabs.agentnet

import android.system.Os
import android.system.OsConstants
import java.io.File
import java.io.InputStream

// Minimal USTAR/GNU-tar reader, enough to unpack a Linux rootfs (regular files,
// directories, symlinks, hardlinks, exec bits). A glibc rootfs is full of symlinks
// (libc.so.6 -> libc-2.x.so, etc.), so symlink support is mandatory, not optional.
// We avoid pulling in a tar library; the format is simple and this keeps the APK lean.
object TarExtractor {
    private const val BLOCK = 512

    fun extract(input: InputStream, dest: File) {
        dest.mkdirs()
        input.buffered().use { stream ->
            val header = ByteArray(BLOCK)
            var globalPax = emptyMap<String, String>()
            var nextPax = emptyMap<String, String>()
            var nextLongName: String? = null
            var nextLongLink: String? = null
            while (true) {
                if (!readFully(stream, header)) break
                if (header.all { it.toInt() == 0 }) break // end-of-archive

                val sizeOctal = cstr(header, 124, 12).trim()
                val size = if (sizeOctal.isEmpty()) 0L else sizeOctal.toLong(8)
                val mode = cstr(header, 100, 8).trim().ifEmpty { "644" }.toInt(8)
                val type = header[156].toInt().toChar()
                when (type) {
                    'g' -> {
                        globalPax = globalPax + parsePax(readTextBody(stream, size))
                        skipFully(stream, padding(size))
                        continue
                    }
                    'x' -> {
                        nextPax = parsePax(readTextBody(stream, size))
                        skipFully(stream, padding(size))
                        continue
                    }
                    'L' -> {
                        nextLongName = readTextBody(stream, size).trimEnd('\u0000', '\n')
                        skipFully(stream, padding(size))
                        continue
                    }
                    'K' -> {
                        nextLongLink = readTextBody(stream, size).trimEnd('\u0000', '\n')
                        skipFully(stream, padding(size))
                        continue
                    }
                }

                val pax = globalPax + nextPax
                val name = pax["path"] ?: nextLongName ?: ustarName(header)
                val linkName = pax["linkpath"] ?: nextLongLink ?: cstr(header, 157, 100)
                nextPax = emptyMap()
                nextLongName = null
                nextLongLink = null
                if (name.isEmpty()) break
                val target = File(dest, name)

                // Apply the entry's metadata. Only regular files carry a body; for those
                // we drain `size` here, and the uniform skip below removes just padding.
                var drained = 0L
                when (type) {
                    '5' -> ensureDirectory(target) // directory
                    '2' -> { // symlink
                        ensureDirectory(target.parentFile)
                        clobber(target) // a dir/file may already sit here; remove it first
                        runCatching { Os.symlink(linkName, target.absolutePath) }
                    }
                    '1' -> { // hardlink: fall back to a symlink into the same rootfs
                        ensureDirectory(target.parentFile)
                        clobber(target)
                        runCatching { Os.symlink(File(dest, linkName).absolutePath, target.absolutePath) }
                    }
                    '0', ' ' -> { // regular file
                        ensureDirectory(target.parentFile)
                        // If a directory (or symlink) already occupies this path, opening
                        // an output stream throws EISDIR — clear it first. (tar archives
                        // can list the same path as different types across entries.)
                        clobber(target)
                        target.outputStream().use { out -> copyExactly(stream, out, size) }
                        runCatching { Os.chmod(target.absolutePath, mode) }
                        drained = size
                    }
                    // unsupported entry (device node, PAX header, etc.): not created;
                    // its body is skipped by the uniform step below.
                }

                // Consume any body bytes not already read, plus block padding, exactly
                // once for every type, so the stream stays aligned to the next header.
                skipFully(stream, (size - drained) + padding(size))
            }
        }
    }

    // Remove whatever currently sits at `path` so the new entry can take its place.
    // Use lstat so a SYMLINK is removed as a link (never followed into its target).
    // A real, non-empty directory is emptied first (File.delete only drops empty dirs).
    private fun clobber(path: File) {
        val st = runCatching { Os.lstat(path.absolutePath) }.getOrNull() ?: return // nothing here
        val isDir = (st.st_mode.toInt() and OsConstants.S_IFMT) == OsConstants.S_IFDIR
        if (isDir) path.listFiles()?.forEach { clobber(it) }
        path.delete()
    }

    private fun ensureDirectory(dir: File?) {
        if (dir == null) return
        val st = runCatching { Os.lstat(dir.absolutePath) }.getOrNull()
        if (st == null) {
            ensureDirectory(dir.parentFile)
            dir.mkdir()
            return
        }
        val isDir = (st.st_mode.toInt() and OsConstants.S_IFMT) == OsConstants.S_IFDIR
        if (isDir) return
        clobber(dir)
        ensureDirectory(dir.parentFile)
        dir.mkdir()
    }

    private fun padding(size: Long): Long = (BLOCK - (size % BLOCK)) % BLOCK

    private fun ustarName(header: ByteArray): String {
        val name = cstr(header, 0, 100)
        val prefix = cstr(header, 345, 155)
        return if (prefix.isEmpty()) name else "$prefix/$name"
    }

    private fun parsePax(text: String): Map<String, String> {
        val out = mutableMapOf<String, String>()
        var pos = 0
        while (pos < text.length) {
            val space = text.indexOf(' ', pos)
            if (space < 0) break
            val len = text.substring(pos, space).toIntOrNull() ?: break
            if (len <= 0 || pos + len > text.length) break
            val record = text.substring(space + 1, pos + len).trimEnd('\n')
            val eq = record.indexOf('=')
            if (eq > 0) out[record.substring(0, eq)] = record.substring(eq + 1)
            pos += len
        }
        return out
    }

    private fun cstr(buf: ByteArray, off: Int, len: Int): String {
        var end = off
        val limit = off + len
        while (end < limit && buf[end].toInt() != 0) end++
        return String(buf, off, end - off, Charsets.UTF_8)
    }

    private fun readFully(s: InputStream, buf: ByteArray): Boolean {
        var read = 0
        while (read < buf.size) {
            val n = s.read(buf, read, buf.size - read)
            if (n < 0) return read > 0 && run { buf.fill(0, read); true }
            read += n
        }
        return true
    }

    private fun copyExactly(s: InputStream, out: java.io.OutputStream, size: Long) {
        var remaining = size
        val chunk = ByteArray(65536)
        while (remaining > 0) {
            val want = minOf(chunk.size.toLong(), remaining).toInt()
            val n = s.read(chunk, 0, want)
            if (n < 0) break
            out.write(chunk, 0, n)
            remaining -= n
        }
    }

    private fun readTextBody(s: InputStream, size: Long): String {
        val out = java.io.ByteArrayOutputStream(size.coerceAtMost(65536).toInt())
        copyExactly(s, out, size)
        return out.toString(Charsets.UTF_8.name())
    }

    private fun skipFully(s: InputStream, count: Long) {
        var remaining = count
        val chunk = ByteArray(65536)
        while (remaining > 0) {
            val n = s.read(chunk, 0, minOf(chunk.size.toLong(), remaining).toInt())
            if (n < 0) break
            remaining -= n
        }
    }
}
