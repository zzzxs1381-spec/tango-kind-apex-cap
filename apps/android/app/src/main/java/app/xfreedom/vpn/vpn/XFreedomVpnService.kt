package app.xfreedom.vpn.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import app.xfreedom.vpn.MainActivity
import app.xfreedom.vpn.engine.EngineRegistry

class XFreedomVpnService : VpnService() {

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> stopVpnService()
            ACTION_START, null -> startVpnService()
        }
        return START_STICKY
    }

    override fun onRevoke() {
        broadcastState(STATE_DISCONNECTED, "VPN permission revoked by Android")
        stopVpnService()
        super.onRevoke()
    }

    private fun startVpnService() {
        ensureForeground()

        val engine = EngineRegistry.firstReady(this)
        if (engine == null) {
            // Deliberately do not create a TUN interface until a verified packet
            // forwarding engine is available. Creating one now would black-hole
            // user traffic while falsely appearing to be connected.
            broadcastState(
                STATE_ENGINE_REQUIRED,
                "VPN permission granted. Native transport engine is not packaged yet.",
            )
            return
        }

        broadcastState(
            STATE_ENGINE_REQUIRED,
            "Engine ${engine.displayName} is registered; transport configuration is required.",
        )
    }

    private fun stopVpnService() {
        broadcastState(STATE_DISCONNECTED, "Disconnected")
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun ensureForeground() {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "XFreedom VPN",
                    NotificationManager.IMPORTANCE_LOW,
                ),
            )
        }

        val openApp = PendingIntent.getActivity(
            this,
            1,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stopVpn = PendingIntent.getService(
            this,
            2,
            Intent(this, XFreedomVpnService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val notification = Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_warning)
            .setContentTitle("XFreedom")
            .setContentText("VPN service is ready; waiting for a verified transport engine")
            .setContentIntent(openApp)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(null, "Отключить", stopVpn).build())
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            @Suppress("DEPRECATION")
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun broadcastState(state: String, message: String) {
        sendBroadcast(
            Intent(ACTION_STATE)
                .setPackage(packageName)
                .putExtra(EXTRA_STATE, state)
                .putExtra(EXTRA_MESSAGE, message),
        )
    }

    companion object {
        const val ACTION_START = "app.xfreedom.vpn.action.START"
        const val ACTION_STOP = "app.xfreedom.vpn.action.STOP"
        const val ACTION_STATE = "app.xfreedom.vpn.action.STATE"

        const val EXTRA_STATE = "state"
        const val EXTRA_MESSAGE = "message"

        const val STATE_ENGINE_REQUIRED = "ENGINE_REQUIRED"
        const val STATE_CONNECTED = "CONNECTED"
        const val STATE_DISCONNECTED = "DISCONNECTED"

        private const val CHANNEL_ID = "xfreedom_vpn"
        private const val NOTIFICATION_ID = 101
    }
}
