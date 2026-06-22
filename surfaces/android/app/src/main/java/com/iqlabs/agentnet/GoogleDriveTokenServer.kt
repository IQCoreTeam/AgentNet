package com.iqlabs.agentnet

import android.util.Log
import org.json.JSONObject
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import kotlin.concurrent.thread

// Loopback-only HTTP bridge used by the proot Node server. It exposes exactly the
// Android-native Google Drive authorization operations the guest needs:
//   /google-drive/authorize  foreground consent, waits for an access token
//   /google-drive/token      silent access token fetch for Drive API calls
//   /google-drive/status     passive connected/not-connected probe
class GoogleDriveTokenServer(private val auth: GoogleDriveAuth) {
    companion object {
        private const val TAG = "AgentNet/GoogleToken"
    }

    @Volatile private var server: ServerSocket? = null

    fun start() {
        if (server != null) return
        // Bind with SO_REUSEADDR so a fast restart (the previous process's socket still in
        // TIME_WAIT) can rebind 127.0.0.1:GOOGLE_AUTH_PORT instead of throwing EADDRINUSE.
        // If it still fails (e.g. a lingering instance is actively holding the port), don't
        // crash the whole Activity over this optional Drive auth bridge — log and skip; a
        // later clean launch rebinds.
        val socket = try {
            ServerSocket().apply {
                reuseAddress = true
                bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), Paths.GOOGLE_AUTH_PORT), 16)
            }
        } catch (e: IOException) {
            Log.w(TAG, "could not bind 127.0.0.1:${Paths.GOOGLE_AUTH_PORT}; Drive bridge disabled this launch", e)
            return
        }
        server = socket
        thread(name = "agentnet-google-token") {
            Log.i(TAG, "listening on 127.0.0.1:${Paths.GOOGLE_AUTH_PORT}")
            while (!socket.isClosed) {
                try {
                    socket.accept().use { handle(it) }
                } catch (e: SocketException) {
                    if (!socket.isClosed) Log.w(TAG, "socket failed", e)
                } catch (e: Exception) {
                    Log.w(TAG, "request failed", e)
                }
            }
        }
    }

    fun stop() {
        server?.close()
        server = null
    }

    private fun handle(socket: Socket) {
        socket.soTimeout = 5000
        val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
        val requestLine = reader.readLine() ?: return
        while (true) {
            val line = reader.readLine() ?: break
            if (line.isEmpty()) break
        }
        val parts = requestLine.split(" ")
        if (parts.size < 2 || parts[0] != "GET") {
            socket.respond(405, JSONObject().put("error", "method_not_allowed"))
            return
        }
        when (parts[1].substringBefore("?")) {
            "/google-drive/authorize" -> socket.respondToken(auth.accessToken(interactive = true), includeToken = false)
            "/google-drive/token" -> socket.respondToken(auth.accessToken(interactive = false), includeToken = true)
            "/google-drive/status" -> socket.respondStatus(auth.accessToken(interactive = false))
            else -> socket.respond(404, JSONObject().put("error", "not_found"))
        }
    }

    private fun Socket.respondStatus(result: GoogleDriveAuth.TokenResult) {
        when (result) {
            is GoogleDriveAuth.TokenResult.Token ->
                respond(200, JSONObject().put("connected", true))
            is GoogleDriveAuth.TokenResult.Error ->
                respond(200, JSONObject().put("connected", false).put("error", result.message))
        }
    }

    private fun Socket.respondToken(result: GoogleDriveAuth.TokenResult, includeToken: Boolean) {
        when (result) {
            is GoogleDriveAuth.TokenResult.Token -> {
                val body = JSONObject().put("ok", true)
                if (includeToken) body.put("access_token", result.value)
                respond(200, body)
            }
            is GoogleDriveAuth.TokenResult.Error ->
                respond(result.status, JSONObject().put("ok", false).put("error", result.message))
        }
    }

    private fun Socket.respond(status: Int, body: JSONObject) {
        val bytes = body.toString().toByteArray(Charsets.UTF_8)
        val reason = when (status) {
            200 -> "OK"
            404 -> "Not Found"
            405 -> "Method Not Allowed"
            409 -> "Conflict"
            else -> "Error"
        }
        getOutputStream().use { out ->
            out.write("HTTP/1.1 $status $reason\r\n".toByteArray(Charsets.US_ASCII))
            out.write("Content-Type: application/json; charset=utf-8\r\n".toByteArray(Charsets.US_ASCII))
            out.write("Cache-Control: no-store\r\n".toByteArray(Charsets.US_ASCII))
            out.write("Content-Length: ${bytes.size}\r\n\r\n".toByteArray(Charsets.US_ASCII))
            out.write(bytes)
        }
    }
}
