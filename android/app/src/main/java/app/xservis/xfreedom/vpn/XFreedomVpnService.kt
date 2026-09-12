package app.xservis.xfreedom.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build

class XFreedomVpnService : VpnService() {
    override fun onCreate() {
        super.onCreate()
        ensureChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                TunnelCoreRegistry.backend.disconnect()
                saveState(false, "Отключено")
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return Service.START_NOT_STICKY
            }
            ACTION_START, null -> startTunnel()
        }
        return Service.START_STICKY
    }

    override fun onRevoke() {
        TunnelCoreRegistry.backend.disconnect()
        saveState(false, "VPN-разрешение отозвано системой")
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        super.onRevoke()
    }

    override fun onDestroy() {
        TunnelCoreRegistry.backend.disconnect()
        super.onDestroy()
    }

    private fun startTunnel() {
        val notification = buildNotification("Подготовка защищённого соединения")
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        val backend = TunnelCoreRegistry.backend
        if (!backend.ready) {
            saveState(false, "Ядро туннеля ещё не подключено в этой сборке")
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return
        }

        backend.connect(this)
            .onSuccess {
                saveState(true, "Подключено через ${backend.id}")
                getSystemService(NotificationManager::class.java)
                    .notify(NOTIFICATION_ID, buildNotification("XFreedom подключён · ${backend.id}"))
            }
            .onFailure { error ->
                saveState(false, "Ошибка туннеля: ${error.message ?: "неизвестная ошибка"}")
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "XFreedom VPN",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = "Состояние активного VPN-туннеля"
                    setShowBadge(false)
                },
            )
        }
    }

    private fun buildNotification(text: String): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setContentTitle("XFreedom")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setOngoing(true)
            .build()
    }

    private fun saveState(connected: Boolean, message: String) {
        getSharedPreferences(PREFS, MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_CONNECTED, connected)
            .putString(KEY_MESSAGE, message)
            .apply()
    }

    companion object {
        const val ACTION_START = "app.xservis.xfreedom.action.START_VPN"
        const val ACTION_STOP = "app.xservis.xfreedom.action.STOP_VPN"
        const val PREFS = "xfreedom_vpn_runtime"
        const val KEY_CONNECTED = "connected"
        const val KEY_MESSAGE = "message"

        private const val CHANNEL_ID = "xfreedom_vpn"
        private const val NOTIFICATION_ID = 1042
    }
}
