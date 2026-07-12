package com.iqlabs.agentnet

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.graphics.drawable.Icon
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
        // Intent extra: which chat to deep-link to when an approval notification is tapped.
        const val EXTRA_OPEN_SESSION = "agentnet.openSession"
    }

    // A session id from a tapped approval notification, stashed until the WebView's JS is
    // ready to receive it (cold start: onCreate runs before the page loads).
    @Volatile private var pendingDeepLink: String? = null
    @Volatile private var pageReady = false

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

    // <input type="file"> in the web composer. A WebView opens no picker on its own, so the
    // attach button did nothing until now — we launch the system document picker and hand the
    // chosen URIs back to the page. The callback MUST be answered (even with null on cancel)
    // or the <input> stays wedged and won't fire again.
    private var fileChooserCallback: android.webkit.ValueCallback<Array<Uri>>? = null
    private val fileChooserLauncher: ActivityResultLauncher<Intent> = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        // Parse the picked URIs ourselves. WebView's FileChooserParams.parseResult only reads
        // intent.getData(); it ignores clipData. But with EXTRA_ALLOW_MULTIPLE (set because the
        // <input> has `multiple`), the photo picker returns even a single pick in clipData, so
        // parseResult yields null and the page sees no file. Read clipData first, then data.
        val d = result.data
        val uris: Array<Uri>? = if (result.resultCode == android.app.Activity.RESULT_OK && d != null) {
            val clip = d.clipData
            when {
                clip != null && clip.itemCount > 0 -> Array(clip.itemCount) { clip.getItemAt(it).uri }
                d.data != null -> arrayOf(d.data!!)
                else -> null
            }
        } else {
            null
        }
        Log.i(TAG, "file chooser code=${result.resultCode} uris=${uris?.size ?: -1} first=${uris?.firstOrNull()}")
        fileChooserCallback?.onReceiveValue(uris)
        fileChooserCallback = null
    }

    // Mic button (voice input). The WebView only asks for the mic via onPermissionRequest
    // AFTER Android grants RECORD_AUDIO to the app, so we hold the pending web request, ask
    // the OS, then grant or deny it once the user answers the system prompt.
    private var pendingMicRequest: android.webkit.PermissionRequest? = null
    private val micPermissionLauncher: ActivityResultLauncher<String> = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        val req = pendingMicRequest ?: return@registerForActivityResult
        pendingMicRequest = null
        if (granted) req.grant(req.resources) else req.deny()
    }

    // ActivityResultSender registers an activity-result callback in its constructor, which
    // must happen before the activity reaches STARTED — so build it as a field, not lazily.
    private val activityResultSender = ActivityResultSender(this)
    // MUST match the app's on-chain network (core seed.ts `NETWORK`, currently devnet). If
    // the wallet signs on a different cluster than the one the app builds and submits the tx
    // to, the buyer account has no lamports there and every buy fails at fee payment with
    // "Attempt to debit an account but found no record of a prior credit. Logs: []". Keep
    // this in lockstep with seed.ts when flipping devnet/mainnet.
    private val walletAdapter = MobileWalletAdapter(
        connectionIdentity = ConnectionIdentity(
            identityUri = Uri.parse(IDENTITY_URI),
            iconUri = Uri.parse(IDENTITY_ICON),
            identityName = IDENTITY_NAME,
        ),
    ).apply { blockchain = Solana.Devnet }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Cold start FROM a tapped approval notification: stash the target chat now; it's
        // drained in onPageFinished once the WebView's JS exists.
        intent?.getStringExtra(EXTRA_OPEN_SESSION)?.let { pendingDeepLink = it }
        setContentView(R.layout.activity_main)
        webView = findViewById(R.id.webview)
        status = findViewById(R.id.status)
        statusSub = findViewById(R.id.statusSub)
        bootBox = findViewById(R.id.bootBox)
        // The logo breathes while we boot — our "loading" cue instead of a progress bar.
        findViewById<android.widget.ImageView>(R.id.logo).apply {
            startAnimation(android.view.animation.AnimationUtils.loadAnimation(this@MainActivity, R.anim.logo_pulse))
            // Debug-only: long-press the boot logo to open the T0 native-exec probe (#115).
            if (BuildConfig.DEBUG) setOnLongClickListener {
                startActivity(Intent(this@MainActivity, NativeProbeActivity::class.java)); true
            }
        }

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
            // Our UI is loaded → drain any deep link a notification tap stashed (cold start
            // reads the intent in onCreate, before the page — and thus its JS — exists).
            override fun onPageFinished(view: WebView, url: String) {
                pageReady = true
                flushDeepLink()
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                // Info, not Debug: retail ROMs drop app debug logs, so WebView console (our
                // only client-side log window) was invisible. Keep it visible in logcat.
                Log.i(TAG, "[web] ${m.sourceId()}:${m.lineNumber()} ${m.message()}")
                return true
            }

            // The composer's attach button taps a hidden <input type="file">. A WebView won't
            // surface a picker by itself. We deliberately do NOT use params.createIntent()
            // (ACTION_GET_CONTENT): on Android 13+ that routes to the system photo picker, whose
            // content://media/picker/... URIs expose metadata but FAIL to stream bytes inside the
            // WebView renderer (FileReader fires a ProgressEvent error). ACTION_OPEN_DOCUMENT goes
            // through SAF/DocumentsUI instead, returning openable URIs the WebView reads reliably.
            override fun onShowFileChooser(
                view: WebView?,
                callback: android.webkit.ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                fileChooserCallback?.onReceiveValue(null) // drop any stale picker so it can't wedge
                fileChooserCallback = callback
                val accept = params.acceptTypes?.filter { it.isNotBlank() } ?: emptyList()
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = accept.singleOrNull() ?: "*/*"
                    if (accept.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, accept.toTypedArray())
                    if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) {
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    }
                }
                return runCatching {
                    fileChooserLauncher.launch(intent)
                    true
                }.getOrElse {
                    Log.w(TAG, "file chooser launch failed", it)
                    fileChooserCallback = null
                    false
                }
            }

            // The composer's mic button asks the WebView for audio capture. Grant it once the
            // app holds RECORD_AUDIO; otherwise request that runtime permission first and grant
            // the held web request from the permission-result callback above.
            override fun onPermissionRequest(request: android.webkit.PermissionRequest) {
                val wantsAudio = request.resources.any {
                    it == android.webkit.PermissionRequest.RESOURCE_AUDIO_CAPTURE
                }
                runOnUiThread {
                    if (!wantsAudio) {
                        request.deny()
                    } else if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                        == PackageManager.PERMISSION_GRANTED
                    ) {
                        request.grant(arrayOf(android.webkit.PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                    } else {
                        pendingMicRequest = request
                        micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                    }
                }
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

    // Approval notification tapped while the app is already running → deep-link to that chat.
    // (SINGLE_TOP makes the system reuse this instance and deliver the intent here.)
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.getStringExtra(EXTRA_OPEN_SESSION)?.let { deepLinkSession(it) }
    }

    // Hand a session id to the WebView so it switches to that chat. If the page's JS isn't
    // up yet (cold start), it's parked and flushed in onPageFinished.
    private fun deepLinkSession(sessionId: String) {
        if (sessionId.isBlank()) return
        pendingDeepLink = sessionId
        flushDeepLink()
    }

    private fun flushDeepLink() {
        val id = pendingDeepLink ?: return
        if (!::webView.isInitialized || !pageReady) return
        pendingDeepLink = null
        val safe = id.replace("\\", "\\\\").replace("'", "\\'")
        // Call the opener if React registered it; otherwise park it for the App to drain on mount.
        val js = "(function(){var s='$safe';" +
            "if(window.__agentnetOpenSession){window.__agentnetOpenSession(s);}" +
            "else{window.__agentnetPendingSession=s;}})()"
        runOnUiThread { runCatching { webView.evaluateJavascript(js, null) } }
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

    // A turn needs approval. When foreground the WebView's own dock shows it, so we normally
    // stay quiet — UNLESS `force` is set, meaning the approval is for a session the user
    // isn't viewing (chat-app style: ping even while using another chat). Tapping deep-links
    // to that chat (sessionId); the Approve / Reject actions POST an approvalDecision to /rpc.
    fun requestApproval(id: String, title: String, clientId: String, body: String, sessionId: String, force: Boolean, isQuestion: Boolean) {
        if (inForeground && !force) return
        val mgr = getSystemService(NotificationManager::class.java) ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            mgr.createNotificationChannel(
                NotificationChannel(APPROVAL_CHANNEL, "AgentNet approvals", NotificationManager.IMPORTANCE_HIGH)
            )
        }
        // Tap carries the sessionId so the WebView can jump to that chat. A distinct request
        // code per session keeps FLAG_UPDATE_CURRENT from collapsing different chats' extras;
        // SINGLE_TOP delivers it via onNewIntent when the activity is already running.
        val tap = PendingIntent.getActivity(
            this, sessionId.hashCode(),
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(EXTRA_OPEN_SESSION, sessionId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, APPROVAL_CHANNEL)
        } else {
            @Suppress("DEPRECATION") Notification.Builder(this)
        }
        // Expanded view shows the title + the code/diff/plan (or the question) so the user can
        // read it without opening the app. Cap it so a huge diff stays sane.
        val code = if (body.length > 1200) body.take(1200) + "\n…" else body
        val expanded = if (code.isNotBlank()) "$title\n\n$code" else title
        builder
            // A question isn't a yes/no — it's the agent ASKING you something, so label it as
            // such; a permission is "Approval needed".
            .setContentTitle(if (isQuestion) "Agent has a question" else "Approval needed")
            .setContentText(title)
            .setStyle(Notification.BigTextStyle().bigText(expanded))
            .setSmallIcon(R.drawable.iq_logo_green)
            .setLargeIcon(Icon.createWithResource(this, R.drawable.iq_logo_green))
            .setContentIntent(tap)
            .setAutoCancel(true)
        // Only a yes/no approval gets Approve/Reject buttons. A question is answered by picking
        // an option in-app, so the notification just deep-links there on tap (no actions).
        if (!isQuestion) {
            builder
                .addAction(android.R.drawable.ic_menu_revert, "Reject", approvalAction("reject", id, clientId, 2))
                .addAction(android.R.drawable.ic_menu_send, "Approve", approvalAction("approve", id, clientId, 3))
        }
        mgr.notify(APPROVAL_NOTIF_ID, builder.build())
    }

    // Drop the approval notification — called when the WebView reports the user is now
    // viewing the chat it belongs to, or the approval was answered. Same id onResume cancels.
    fun clearApprovalNotice() {
        getSystemService(NotificationManager::class.java)?.cancel(APPROVAL_NOTIF_ID)
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
        // Only a real close (back button / finish(), isFinishing=true) reaches here and tears
        // down the server. Backgrounding (HOME, the recents/edge-swipe gesture) is onStop with
        // isFinishing=false and NO onDestroy — the server stays alive and the WebView resumes
        // untouched. server.stop() kills the whole proot→node guest tree (see ServerManager).
        if (::googleTokenServer.isInitialized) googleTokenServer.stop()
        stopService(Intent(this, ServerService::class.java)) // no orphaned foreground notif
        server.stop()
        super.onDestroy()
    }
}
