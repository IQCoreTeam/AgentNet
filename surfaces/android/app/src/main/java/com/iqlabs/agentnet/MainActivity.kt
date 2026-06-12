package com.iqlabs.agentnet

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import com.solana.mobilewalletadapter.clientlib.ConnectionIdentity
import com.solana.mobilewalletadapter.clientlib.MobileWalletAdapter
import com.solana.mobilewalletadapter.clientlib.Solana
import kotlin.concurrent.thread

// The shell. On launch it (1) extracts the proot guest + server bundle on first run,
// (2) starts the foreground service + node server inside proot, (3) waits for the
// server to answer on 127.0.0.1, then (4) shows the WebView pointed at it. The WebView
// loads our React web surface served by surfaces/localhost; from there everything is
// identical to the browser/vscode surfaces (one UI, one transport). No JS bridge — the
// WebView just speaks HTTP/SSE to the loopback server, exactly like a browser.
class MainActivity : AppCompatActivity() {
    companion object {
        private const val TAG = "AgentNet/Main"
        private const val URL = "http://127.0.0.1:${Paths.PORT}/"
        // dApp identity shown in the wallet's approval sheet. Placeholder host for now —
        // swap to the real product URL once it exists (the wallet may display/verify it).
        private const val IDENTITY_NAME = "AgentNet"
        private const val IDENTITY_URI = "https://agentnet.iqlabs.com"
        private const val IDENTITY_ICON = "favicon.ico" // relative to IDENTITY_URI
    }

    private lateinit var webView: WebView
    private lateinit var status: TextView
    private val server by lazy { ServerManager(this) }

    // ActivityResultSender registers an activity-result callback in its constructor, which
    // must happen before the activity reaches STARTED — so build it as a field, not lazily.
    private val activityResultSender = ActivityResultSender(this)
    private val walletAdapter = MobileWalletAdapter(
        connectionIdentity = ConnectionIdentity(
            identityUri = Uri.parse(IDENTITY_URI),
            iconUri = Uri.parse(IDENTITY_ICON),
            identityName = IDENTITY_NAME,
        ),
    ).apply { blockchain = Solana.Mainnet }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        webView = findViewById(R.id.webview)
        status = findViewById(R.id.status)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            mediaPlaybackRequiresUserGesture = false
        }
        webView.webViewClient = object : WebViewClient() {
            // Keep navigation inside the WebView; the wallet deep-link (window.solana →
            // Phantom app) is the one case the app should hand off — handled by the
            // default browsable intent when the page calls it.
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean = false
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                Log.d(TAG, "[web] ${m.sourceId()}:${m.lineNumber()} ${m.message()}")
                return true
            }
        }

        // Native wallet-connect bridge. The React onboarding probes window.AgentNetWallet
        // and, when present (i.e. inside this shell), drives MWA instead of looking for a
        // browser extension that a mobile WebView will never have.
        webView.addJavascriptInterface(
            WalletBridge(this, webView, walletAdapter, activityResultSender),
            "AgentNetWallet",
        )

        startServerFlow()
    }

    private fun setStatus(text: String) = runOnUiThread {
        status.text = text
        status.visibility = android.view.View.VISIBLE
        webView.visibility = android.view.View.GONE
    }

    private fun showWebView() = runOnUiThread {
        status.visibility = android.view.View.GONE
        webView.visibility = android.view.View.VISIBLE
        webView.loadUrl(URL)
    }

    // Everything heavy runs off the UI thread; the UI shows progress until the server
    // is ready. Errors surface in the status view instead of a blank WebView.
    private fun startServerFlow() {
        // Keep the server alive across backgrounding before we start it.
        val svc = Intent(this, ServerService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(svc)
        else startService(svc)

        thread {
            try {
                val installer = Installer(this)
                installer.install { setStatus(it) }

                setStatus("Starting AgentNet…")
                if (!server.start()) { setStatus("Failed to start the server."); return@thread }
                if (!server.waitForServer()) { setStatus("Server did not come up. Check logs."); return@thread }

                showWebView()
            } catch (e: Exception) {
                Log.e(TAG, "setup failed", e)
                setStatus("Setup failed: ${e.message}")
            }
        }
    }

    override fun onDestroy() {
        server.stop()
        super.onDestroy()
    }
}
