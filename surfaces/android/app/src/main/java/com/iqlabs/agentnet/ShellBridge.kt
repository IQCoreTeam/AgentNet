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
    fun setAgentActive(active: Boolean, clientId: String, keepWhileLocked: Boolean) {
        activity.runOnUiThread { runCatching { activity.setAgentActive(active, clientId, keepWhileLocked) } }
    }

    // #53: a turn is waiting on approval → raise a notification. `sessionId` lets a tap
    // deep-link to that chat; `force` raises it even in foreground (the approval is for a
    // session the user isn't viewing — chat-app style ping).
    @JavascriptInterface
    fun requestApproval(id: String, title: String, clientId: String, body: String, sessionId: String, force: Boolean, isQuestion: Boolean) {
        activity.runOnUiThread { runCatching { activity.requestApproval(id, title, clientId, body, sessionId, force, isQuestion) } }
    }

    // The user is now viewing the chat an approval belongs to (or answered it) → drop its
    // notification, the way a chat app clears a conversation's alert once you open it.
    @JavascriptInterface
    fun clearApprovalNotice() {
        activity.runOnUiThread { runCatching { activity.clearApprovalNotice() } }
    }

    // #53: user just enabled background execution → prompt for battery-opt exemption (once).
    @JavascriptInterface
    fun onBackgroundEnabled() {
        activity.runOnUiThread { runCatching { activity.onBackgroundEnabled() } }
    }

    // A completed turn gets a softer lock-screen alert when screen-off execution is enabled.
    @JavascriptInterface
    fun notifyTurnComplete(sessionId: String) {
        activity.runOnUiThread { runCatching { activity.notifyTurnComplete(sessionId) } }
    }
}
