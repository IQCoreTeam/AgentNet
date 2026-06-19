package com.iqlabs.agentnet

import android.content.Intent
import android.net.Uri
import android.webkit.JavascriptInterface
import androidx.appcompat.app.AppCompatActivity

class ShellBridge(private val activity: AppCompatActivity) {
    @JavascriptInterface
    fun openUrl(url: String) {
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return
        val scheme = uri.scheme
        if (scheme != "http" && scheme != "https") return
        activity.runOnUiThread {
            runCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
        }
    }
}
