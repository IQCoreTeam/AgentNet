package com.iqlabs.agentnet

import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import com.solana.mobilewalletadapter.clientlib.MobileWalletAdapter
import com.solana.mobilewalletadapter.clientlib.TransactionResult
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

// JS <-> native bridge for Solana Mobile Wallet Adapter (MWA). On a mobile WebView there
// is no window.phantom to inject, so the React onboarding can't reach a wallet the usual
// way. Instead it calls into this @JavascriptInterface, which runs the MWA `transact`
// flow (launches the installed wallet app, the user approves + signs), and pushes the
// result back into JS via evaluateJavascript.
//
// The bridge is FIRE-AND-CALLBACK: @JavascriptInterface methods must return promptly, but
// transact is a long suspend op (round-trips through the wallet app). So connect() only
// launches a coroutine and returns; the answer arrives later via window.__onWalletResult.
// Every path — success, no-wallet, failure, exception — MUST call back, or the JS Promise
// waiting on it hangs forever (button stuck on "Connecting…").
//
// Wire protocol (JSON strings only — @JavascriptInterface can't marshal arrays/objects):
//   in : connect('{"id":"<callbackId>","message":"<utf8 string to sign>"}')
//   out: window.__onWalletResult('{"id",...}')
//        success {id, ok:true,  pubkey:number[32], signature:number[64]}
//        failure {id, ok:false, error:string, reason:"NoWalletFound"|"Failure"}
// We send the RAW pubkey bytes (not base58) and let JS base58-encode with @solana/web3.js
// (already bundled), so the address string matches exactly what the backend parses back.
class WalletBridge(
    private val activity: AppCompatActivity,
    private val webView: WebView,
    private val walletAdapter: MobileWalletAdapter,
    private val sender: ActivityResultSender,
) {
    companion object {
        private const val TAG = "AgentNet/Wallet"
    }

    @JavascriptInterface
    fun connect(requestJson: String) {
        // Runs on a WebView JavaBridge thread — do no UI work here, just launch.
        val req = runCatching { JSONObject(requestJson) }.getOrNull()
        val id = req?.optString("id").orEmpty()
        val message = req?.optString("message").orEmpty()
        if (id.isEmpty() || message.isEmpty()) {
            Log.e(TAG, "connect: malformed request")
            if (id.isNotEmpty()) pushError(id, "Malformed wallet request.", "Failure")
            return
        }
        // Encode the message to UTF-8 here so the bytes are identical to the web path's
        // TextEncoder().encode(SESSION_KEY_MESSAGE) — the session key is derived from the
        // signature over exactly these bytes, so they must match byte-for-byte.
        val msgBytes = message.toByteArray(Charsets.UTF_8)
        activity.lifecycleScope.launch {
            try {
                runTransact(id, msgBytes)
            } catch (e: Exception) {
                Log.e(TAG, "transact threw", e)
                pushError(id, e.message ?: "Wallet request failed.", "Failure")
            }
        }
    }

    private suspend fun runTransact(id: String, msgBytes: ByteArray) {
        val result = walletAdapter.transact(sender) { authResult ->
            val pubkey: ByteArray = authResult.accounts.first().publicKey // raw 32 bytes
            val signResult = signMessagesDetached(
                messages = arrayOf(msgBytes),
                addresses = arrayOf(pubkey),
            )
            val signed = signResult.messages.first()
            // The wallet must have signed our exact bytes — some wallets may wrap/modify
            // the payload, which would derive a different (wrong) session key. Fail loud
            // rather than silently corrupt. (See webWallet.ts.)
            require(signed.message.contentEquals(msgBytes)) {
                "wallet modified the message before signing"
            }
            val signature: ByteArray = signed.signatures.first() // raw 64 bytes
            Pair(pubkey, signature)
        }
        when (result) {
            is TransactionResult.Success -> {
                val (pubkey, signature) = result.payload
                pushSuccess(id, pubkey, signature)
            }
            is TransactionResult.NoWalletFound ->
                pushError(id, "No compatible wallet app is installed.", "NoWalletFound")
            is TransactionResult.Failure ->
                pushError(id, result.e.message ?: "Wallet request failed.", "Failure")
        }
    }

    private fun pushSuccess(id: String, pubkey: ByteArray, signature: ByteArray) {
        val json = JSONObject()
            .put("id", id)
            .put("ok", true)
            .put("pubkey", bytesToJson(pubkey))
            .put("signature", bytesToJson(signature))
        dispatch(json.toString())
    }

    private fun pushError(id: String, message: String, reason: String) {
        val json = JSONObject()
            .put("id", id)
            .put("ok", false)
            .put("error", message)
            .put("reason", reason)
        dispatch(json.toString())
    }

    // Hand the JSON result to the JS dispatcher. evaluateJavascript must run on the
    // WebView (UI) thread; the coroutine result may be on a background dispatcher.
    // JSONObject.quote turns the JSON into a safe JS string literal (escapes quotes), so
    // the shim receives a string it then JSON.parses.
    private fun dispatch(resultJson: String) {
        webView.post {
            val js = "window.__onWalletResult(${JSONObject.quote(resultJson)});"
            webView.evaluateJavascript(js, null)
        }
    }

    @JavascriptInterface
    fun signTransaction(requestJson: String) {
        val req = runCatching { JSONObject(requestJson) }.getOrNull()
        val id = req?.optString("id").orEmpty()
        val txJson = req?.optJSONArray("transaction")
        if (id.isEmpty() || txJson == null) {
            Log.e(TAG, "signTransaction: malformed request")
            if (id.isNotEmpty()) pushError(id, "Malformed signTransaction request.", "Failure")
            return
        }
        val txBytes = ByteArray(txJson.length())
        for (i in 0 until txBytes.size) {
            txBytes[i] = txJson.getInt(i).toByte()
        }
        activity.lifecycleScope.launch {
            try {
                runSignTransaction(id, txBytes)
            } catch (e: Exception) {
                Log.e(TAG, "signTransaction threw", e)
                pushError(id, e.message ?: "Wallet transaction signing failed.", "Failure")
            }
        }
    }

    private suspend fun runSignTransaction(id: String, txBytes: ByteArray) {
        val result = walletAdapter.transact(sender) {
            val signResult = signTransactions(
                transactions = arrayOf(txBytes)
            )
            signResult.transactions.first()
        }
        when (result) {
            is TransactionResult.Success -> {
                val signedTx = result.payload
                pushTxSuccess(id, signedTx)
            }
            is TransactionResult.NoWalletFound ->
                pushError(id, "No compatible wallet app is installed.", "NoWalletFound")
            is TransactionResult.Failure ->
                pushError(id, result.e.message ?: "Wallet request failed.", "Failure")
        }
    }

    private fun pushTxSuccess(id: String, signedTx: ByteArray) {
        val json = JSONObject()
            .put("id", id)
            .put("ok", true)
            .put("transaction", bytesToJson(signedTx))
        dispatch(json.toString())
    }

    private fun bytesToJson(bytes: ByteArray): JSONArray {
        val arr = JSONArray()
        for (b in bytes) arr.put(b.toInt() and 0xFF)
        return arr
    }
}
