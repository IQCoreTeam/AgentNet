package com.iqlabs.agentnet

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder

// Foreground service that keeps the node server (and the running agent turn) alive when the
// app is backgrounded. Android aggressively kills background processes; a foreground service
// with an ongoing notification is the supported way to say "I'm doing work the user asked
// for, don't kill me". (Generic Android pattern, same shape as AnyClaw's foreground service.)
//
// #53: the notification tells the user what's running, taps back into the chat, and offers a
// Stop action that cancels the turn (posts {type:"interrupt"} to /rpc via NotifActionReceiver).
class ServerService : Service() {
    companion object {
        private const val CHANNEL = "agentnet_server"
        private const val NOTIF_ID = 1
        const val EXTRA_CLIENT = "client" // SSE client id, so Stop can reach /rpc
    }

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL, "AgentNet", NotificationManager.IMPORTANCE_LOW)
            )
        }
        startForeground(NOTIF_ID, notification(""))
    }

    // Each start carries the latest client id; rebuild the notification so Stop targets the
    // live SSE client. NOT sticky (#53): runs only while a turn is active — if Android kills
    // it we don't want it auto-resurrected with no work to do; the next turn restarts it.
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val client = intent?.getStringExtra(EXTRA_CLIENT) ?: ""
        startForeground(NOTIF_ID, notification(client))
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun notification(client: String): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL)
        } else {
            @Suppress("DEPRECATION") Notification.Builder(this)
        }

        // Tap → bring the chat to the front.
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        // Stop → interrupt the turn + demote the service (handled in NotifActionReceiver).
        val stop = PendingIntent.getBroadcast(
            this, 1,
            Intent(this, NotifActionReceiver::class.java).apply {
                action = NotifActionReceiver.ACTION
                putExtra(NotifActionReceiver.EXTRA_KIND, "stop")
                putExtra(NotifActionReceiver.EXTRA_CLIENT, client)
                putExtra(NotifActionReceiver.EXTRA_NOTIF_ID, NOTIF_ID)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        return builder
            .setContentTitle("AgentNet is working")
            .setContentText("An agent task is running in the background")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stop)
            .build()
    }
}
