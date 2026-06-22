package com.iqlabs.agentnet

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
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
// identical to the browser/vscode surfaces (one UI, one transport). Chat/data flow over
// HTTP/SSE to the loopback server like a browser; the one exception is wallet signing —
// mobile WebViews have no injected wallet, so we addJavascriptInterface an MWA WalletBridge
// (+ a ShellBridge) below.
class MainActivity : AppCompatActivity() {
    companion object {
        private const val TAG = "AgentNet/Main"
        private const val URL = "http://127.0.0.1:${Paths.PORT}/"
        // dApp identity shown in the wallet's approval sheet. Placeholder host for now —
        // swap to the real product URL once it exists (the wallet may display/verify it).
        private const val IDENTITY_NAME = "AgentNet"
        private const val IDENTITY_URI = "https://agentnet.iqlabs.com"
        private const val IDENTITY_ICON = "favicon.ico" // relative to IDENTITY_URI
        private const val APPROVAL_CHANNEL = "agentnet_approval"
        private const val APPROVAL_NOTIF_ID = 2
        private const val REQ_POST_NOTIFICATIONS = 101
    }

    // Whether the Activity is currently in the foreground. An approval that arrives while
    // foreground is handled in the WebView; only a backgrounded one raises a notification.
    @Volatile private var inForeground = false

    private lateinit var webView: WebView
    private lateinit var status: TextView
    private lateinit var statusSub: TextView
    private lateinit var bootBox: android.view.View
    private val server by lazy { ServerManager(this) }
    private val googleDriveLauncher: ActivityResultLauncher<IntentSenderRequest> = registerForActivityResult(
        ActivityResultContracts.StartIntentSenderForResult(),
    ) { result ->
        if (::googleDriveAuth.isInitialized) googleDriveAuth.handleResolution(result.data)
    }
    private lateinit var googleDriveAuth: GoogleDriveAuth
    private lateinit var googleTokenServer: GoogleDriveTokenServer

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
        statusSub = findViewById(R.id.statusSub)
        bootBox = findViewById(R.id.bootBox)
        // The logo breathes while we boot — our "loading" cue instead of a progress bar.
        findViewById<android.widget.ImageView>(R.id.logo)
            .startAnimation(android.view.animation.AnimationUtils.loadAnimation(this, R.anim.logo_pulse))

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            mediaPlaybackRequiresUserGesture = false
        }
        webView.webViewClient = object : WebViewClient() {
            // Our app UI is served from the loopback server (127.0.0.1) — keep that inside
            // the WebView. Any OTHER http(s) link (e.g. the Claude OAuth login page the
            // ConnectClaude screen surfaces) must open in the EXTERNAL browser: otherwise
            // claude.ai would take over our WebView and the user couldn't get back to paste
            // their code. Opening externally lets them authorize, then return to the app.
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                val host = runCatching { Uri.parse(url).host }.getOrNull() ?: return false
                if (host == "127.0.0.1" || host == "localhost") return false // our UI: stay in
                return runCatching {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    true // handled: opened externally
                }.getOrDefault(false)
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                // Info, not Debug: retail ROMs drop app debug logs, so WebView console (our
                // only client-side log window) was invisible. Keep it visible in logcat.
                Log.i(TAG, "[web] ${m.sourceId()}:${m.lineNumber()} ${m.message()}")
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
        webView.addJavascriptInterface(ShellBridge(this), "AgentNetShell")

        googleDriveAuth = GoogleDriveAuth(this, googleDriveLauncher)
        googleTokenServer = GoogleDriveTokenServer(googleDriveAuth)
        googleTokenServer.start()

        // Android 13+ needs runtime consent to post notifications. We need it for the
        // backgrounded-approval alert (#53); best-effort, the app works without it.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_POST_NOTIFICATIONS)
        }

        startServerFlow()
    }

    override fun onResume() {
        super.onResume()
        inForeground = true
        // Returning to the app clears any pending approval alert — the WebView shows it now.
        getSystemService(NotificationManager::class.java)?.cancel(APPROVAL_NOTIF_ID)
    }

    override fun onPause() {
        inForeground = false
        super.onPause()
    }

    // ── ShellBridge entry points (#53) ──────────────────────────────────────────────

    // Promote/demote the foreground service that keeps this process (and the node runtime)
    // alive while backgrounded. The web UI calls this with `active && backgroundExecEnabled`.
    // `clientId` rides along so the notification's Stop action can reach /rpc.
    fun setAgentActive(active: Boolean, clientId: String) {
        val svc = Intent(this, ServerService::class.java).putExtra(ServerService.EXTRA_CLIENT, clientId)
        if (active) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(svc)
            else startService(svc)
        } else {
            stopService(svc)
        }
    }

    // First time the user enables background execution: ask to exempt us from battery
    // optimization so Android doesn't reap a long-running background task. Guarded so we
    // only ever prompt once (and skip if already exempt).
    @SuppressLint("BatteryLife")
    fun onBackgroundEnabled() {
        val prefs = getSharedPreferences("agentnet", MODE_PRIVATE)
        if (prefs.getBoolean("batteryPrompted", false)) return
        val pm = getSystemService(android.os.PowerManager::class.java)
        if (pm?.isIgnoringBatteryOptimizations(packageName) == true) return
        prefs.edit().putBoolean("batteryPrompted", true).apply()
        runCatching {
            startActivity(
                Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                    .setData(Uri.parse("package:$packageName")),
            )
        }
    }

    // A turn needs approval. If the app is foreground the WebView already shows it, so we
    // only raise a notification when backgrounded. Tapping reopens the chat; the Approve /
    // Reject actions POST an approvalDecision to /rpc (same as the in-app buttons).
    fun requestApproval(id: String, title: String, clientId: String) {
        if (inForeground) return
        val mgr = getSystemService(NotificationManager::class.java) ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            mgr.createNotificationChannel(
                NotificationChannel(APPROVAL_CHANNEL, "AgentNet approvals", NotificationManager.IMPORTANCE_HIGH)
            )
        }
        val tap = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, APPROVAL_CHANNEL)
        } else {
            @Suppress("DEPRECATION") Notification.Builder(this)
        }
        mgr.notify(
            APPROVAL_NOTIF_ID,
            builder
                .setContentTitle("Approval needed")
                .setContentText(title)
                .setSmallIcon(android.R.drawable.stat_sys_warning)
                .setContentIntent(tap)
                .setAutoCancel(true)
                .addAction(android.R.drawable.ic_menu_revert, "Reject", approvalAction("reject", id, clientId, 2))
                .addAction(android.R.drawable.ic_menu_send, "Approve", approvalAction("approve", id, clientId, 3))
                .build(),
        )
    }

    // PendingIntent → NotifActionReceiver for an approve/reject button. `reqCode` keeps the
    // two PendingIntents distinct (same Intent action would otherwise collide).
    private fun approvalAction(kind: String, id: String, clientId: String, reqCode: Int): PendingIntent =
        PendingIntent.getBroadcast(
            this, reqCode,
            Intent(this, NotifActionReceiver::class.java).apply {
                action = NotifActionReceiver.ACTION
                putExtra(NotifActionReceiver.EXTRA_KIND, kind)
                putExtra(NotifActionReceiver.EXTRA_CLIENT, clientId)
                putExtra(NotifActionReceiver.EXTRA_APPROVAL_ID, id)
                putExtra(NotifActionReceiver.EXTRA_NOTIF_ID, APPROVAL_NOTIF_ID)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    // A status may carry a muted second line after a newline ("main\nsubtitle"); split it
    // so the splash shows a bright primary line over a dimmer detail line.
    private fun setStatus(text: String) = runOnUiThread {
        val parts = text.split("\n", limit = 2)
        status.text = parts[0]
        if (parts.size > 1 && parts[1].isNotBlank()) {
            statusSub.text = parts[1]
            statusSub.visibility = android.view.View.VISIBLE
        } else {
            statusSub.visibility = android.view.View.GONE
        }
        bootBox.visibility = android.view.View.VISIBLE
        webView.visibility = android.view.View.GONE
    }

    private fun showWebView() = runOnUiThread {
        bootBox.visibility = android.view.View.GONE
        webView.visibility = android.view.View.VISIBLE
        webView.loadUrl(URL)
    }

    // Everything heavy runs off the UI thread; the UI shows progress until the server
    // is ready. Errors surface in the status view instead of a blank WebView.
    // NOTE (#53): we do NOT start ServerService here anymore. The node server runs as a
    // child of this process and lives as long as the Activity is foreground. The
    // foreground service is promoted only while a turn is active AND the user enabled
    // background exec — driven from the web UI via ShellBridge.setAgentActive().
    private fun startServerFlow() {
        thread {
            try {
                val installer = Installer(this)
                installer.install { setStatus(it) }

                setStatus("Starting up")
                if (!server.start()) { setStatus("Couldn't start.\nPlease reopen the app."); return@thread }
                if (!server.waitForServer()) { setStatus("Taking longer than usual.\nPlease reopen the app."); return@thread }

                showWebView()
            } catch (e: Exception) {
                Log.e(TAG, "setup failed", e)
                setStatus("Setup failed: ${e.message}")
            }
        }
    }

    override fun onDestroy() {
        if (::googleTokenServer.isInitialized) googleTokenServer.stop()
        stopService(Intent(this, ServerService::class.java)) // no orphaned foreground notif
        server.stop()
        super.onDestroy()
    }
}
