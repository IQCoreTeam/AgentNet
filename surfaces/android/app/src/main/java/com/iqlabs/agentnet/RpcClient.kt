package com.iqlabs.agentnet

import android.util.Log
import java.net.HttpURLConnection
import java.net.URL

// Posts a single UI→server command to the loopback node server's /rpc, exactly as the
// WebView does (POST /rpc?client=<id>, JSON body). Used by notification actions (#53) —
// Stop / Approve / Reject — so they drive the engine through the SAME path as the in-app
// buttons (no protocol fork, no weakening of the approval gate). The server acks 204 and
// streams the real effect back over the client's SSE.
object RpcClient {
    private const val TAG = "AgentNet/Rpc"

    // `jsonBody` is a ready-made JSON object string, e.g. {"type":"interrupt"} or
    // {"type":"approvalDecision","id":"…","outcome":"deny"}. Runs on the caller's thread;
    // callers (a BroadcastReceiver via goAsync) are already off the main thread.
    fun post(clientId: String, jsonBody: String): Boolean {
        if (clientId.isBlank()) { Log.w(TAG, "no client id; dropping $jsonBody"); return false }
        return try {
            val url = URL("http://127.0.0.1:${Paths.PORT}/rpc?client=" + java.net.URLEncoder.encode(clientId, "UTF-8"))
            (url.openConnection() as HttpURLConnection).run {
                requestMethod = "POST"
                connectTimeout = 3000
                readTimeout = 3000
                doOutput = true
                setRequestProperty("content-type", "application/json")
                outputStream.use { it.write(jsonBody.toByteArray()) }
                val code = responseCode
                disconnect()
                Log.i(TAG, "rpc $jsonBody → HTTP $code")
                code in 200..399
            }
        } catch (e: Exception) {
            Log.e(TAG, "rpc post failed: $jsonBody", e)
            false
        }
    }
}
