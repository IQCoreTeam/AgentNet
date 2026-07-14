package com.iqlabs.agentnet

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.drawable.Icon
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

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
        private const val WAKE_LOCK_TIMEOUT_MS = 6 * 60 * 60 * 1000L
        const val EXTRA_CLIENT = "client" // SSE client id, so Stop can reach /rpc
        const val EXTRA_KEEP_WHILE_LOCKED = "keepWhileLocked"
    }

    private var keepWhileLocked = false
    private var wakeLock: PowerManager.WakeLock? = null
    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                Intent.ACTION_SCREEN_OFF, Intent.ACTION_SCREEN_ON -> updateWakeLock()
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL, "AgentNet", NotificationManager.IMPORTANCE_LOW)
            )
        }
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(screenReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION") registerReceiver(screenReceiver, filter)
        }
        startForeground(NOTIF_ID, notification(""))
    }

    // Each start carries the latest client id; rebuild the notification so Stop targets the
    // live SSE client. NOT sticky (#53): runs only while a turn is active — if Android kills
    // it we don't want it auto-resurrected with no work to do; the next turn restarts it.
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val client = intent?.getStringExtra(EXTRA_CLIENT) ?: ""
        keepWhileLocked = intent?.getBooleanExtra(EXTRA_KEEP_WHILE_LOCKED, false) == true
        startForeground(NOTIF_ID, notification(client))
        updateWakeLock()
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // A partial wakelock keeps the CPU and node runtime alive without lighting the display.
    // It is held only while this active-turn service is alive, the user opted in, and the
    // display is off. The timeout is a final leak guard; every normal lifecycle path releases.
    private fun updateWakeLock() {
        val power = getSystemService(PowerManager::class.java) ?: return
        if (keepWhileLocked && !power.isInteractive) {
            val lock = wakeLock ?: power.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "$packageName:agent-turn",
            ).apply { setReferenceCounted(false) }.also { wakeLock = it }
            if (!lock.isHeld) lock.acquire(WAKE_LOCK_TIMEOUT_MS)
        } else {
            releaseWakeLock()
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let { if (it.isHeld) runCatching { it.release() } }
        wakeLock = null
    }

    override fun onDestroy() {
        keepWhileLocked = false
        releaseWakeLock()
        runCatching { unregisterReceiver(screenReceiver) }
        super.onDestroy()
    }

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
            .setContentTitle("AgentNet is running")
            .setContentText("Your agent is working in the background.")
            .setSmallIcon(R.drawable.iq_logo_green)
            .setLargeIcon(Icon.createWithResource(this, R.drawable.iq_logo_green))
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stop)
            .build()
    }
}
