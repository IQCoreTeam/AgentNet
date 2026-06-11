package com.iqlabs.agentnet

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder

// Foreground service that keeps the node server (and any running agent turn) alive when
// the app is backgrounded. Android aggressively kills background processes; a foreground
// service with an ongoing notification is the supported way to say "I'm doing work the
// user asked for, don't kill me". START_STICKY asks Android to restart us if it does.
// (Generic Android pattern, same shape as AnyClaw's foreground service.)
class ServerService : Service() {
    companion object {
        private const val CHANNEL = "agentnet_server"
        private const val NOTIF_ID = 1
    }

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(NotificationManager::class.java)
            mgr.createNotificationChannel(
                NotificationChannel(CHANNEL, "AgentNet", NotificationManager.IMPORTANCE_LOW)
            )
        }
        startForeground(NOTIF_ID, notification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onBind(intent: Intent?): IBinder? = null

    private fun notification(): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL)
        } else {
            @Suppress("DEPRECATION") Notification.Builder(this)
        }
        return builder
            .setContentTitle("AgentNet is running")
            .setContentText("Local agent server active")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .build()
    }
}
