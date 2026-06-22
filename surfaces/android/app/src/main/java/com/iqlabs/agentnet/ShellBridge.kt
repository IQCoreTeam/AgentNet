package com.iqlabs.agentnet

import android.content.Intent
import android.net.Uri
import android.webkit.JavascriptInterface

// Web→native bridge injected as `window.AgentNetShell`. Methods are best-effort and hop to
// the UI thread where they touch Activity/service state.
class ShellBridge(private val activity: MainActivity) {
    @JavascriptInterface
    fun openUrl(url: String) {
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return
        val scheme = uri.scheme
        if (scheme != "http" && scheme != "https") return
        activity.runOnUiThread {
            runCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
        }
    }

    // #53: turn started/ended → promote/demote the background foreground service.
    @JavascriptInterface
    fun setAgentActive(active: Boolean, clientId: String) {
        activity.runOnUiThread { runCatching { activity.setAgentActive(active, clientId) } }
    }

    // #53: a turn is waiting on approval → raise a notification if the app is backgrounded.
    @JavascriptInterface
    fun requestApproval(id: String, title: String, clientId: String) {
        activity.runOnUiThread { runCatching { activity.requestApproval(id, title, clientId) } }
    }

    // #53: user just enabled background execution → prompt for battery-opt exemption (once).
    @JavascriptInterface
    fun onBackgroundEnabled() {
        activity.runOnUiThread { runCatching { activity.onBackgroundEnabled() } }
    }
}
