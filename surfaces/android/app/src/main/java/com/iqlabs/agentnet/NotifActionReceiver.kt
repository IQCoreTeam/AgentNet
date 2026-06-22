package com.iqlabs.agentnet

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// Handles the notification action buttons (#53): Stop a running turn, or Approve/Reject a
// pending tool approval. Each maps to one /rpc message — the same message the in-app button
// sends — so the engine is driven through the unchanged dispatcher/approval path.
//
// A BroadcastReceiver's onReceive runs on the main thread and can't block on network, so we
// goAsync() and do the POST on a worker thread, then finish().
class NotifActionReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION = "com.iqlabs.agentnet.NOTIF_ACTION"
        const val EXTRA_KIND = "kind"         // "stop" | "approve" | "reject"
        const val EXTRA_CLIENT = "client"     // SSE client id to route the POST
        const val EXTRA_APPROVAL_ID = "approvalId" // for approve/reject
        const val EXTRA_NOTIF_ID = "notifId"  // notification to dismiss after acting
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
        val kind = intent.getStringExtra(EXTRA_KIND) ?: return
        val client = intent.getStringExtra(EXTRA_CLIENT) ?: ""
        val approvalId = intent.getStringExtra(EXTRA_APPROVAL_ID)
        val notifId = intent.getIntExtra(EXTRA_NOTIF_ID, -1)

        // Dismiss the notification immediately so the tap feels responsive.
        if (notifId >= 0) {
            context.getSystemService(NotificationManager::class.java)?.cancel(notifId)
        }

        val body = when (kind) {
            "stop" -> """{"type":"interrupt"}"""
            "approve" -> """{"type":"approvalDecision","id":${jsonStr(approvalId)},"outcome":"once"}"""
            "reject" -> """{"type":"approvalDecision","id":${jsonStr(approvalId)},"outcome":"deny","reason":"Rejected from notification"}"""
            else -> return
        }

        val pending = goAsync()
        Thread {
            try {
                RpcClient.post(client, body)
                // Stop also demotes the foreground service (no more active work to hold it).
                if (kind == "stop") context.stopService(Intent(context, ServerService::class.java))
            } finally {
                pending.finish()
            }
        }.start()
    }

    // Minimal JSON string escaping for the approval id (ids are engine-generated, but be safe).
    private fun jsonStr(s: String?): String {
        val v = s ?: ""
        return "\"" + v.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
    }
}
