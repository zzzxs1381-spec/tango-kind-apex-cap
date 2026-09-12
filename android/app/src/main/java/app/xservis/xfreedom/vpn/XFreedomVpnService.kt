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
    @Volatile
    private var activeBackend: TunnelBackend? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> stopTunnel("Отключено")
            ACTION_START_XRAY -> {
                val config = intent.getStringExtra(EXTRA_XRAY_CONFIG).orEmpty()
                startXray(config)
            }
            else -> {
                publishState(false, "Неизвестная команда VPN")
                stopSelf()
            }
        }
        return Service.START_NOT_STICKY
    }

    override fun onRevoke() {
        activeBackend?.disconnect()
        activeBackend = null
        publishState(false, "VPN-разрешение отозвано системой")
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        super.onRevoke()
    }

    override fun onDestroy() {
        activeBackend?.disconnect()
        activeBackend = null
        super.onDestroy()
    }

    private fun startXray(config: String) {
        startForegroundNow("Запуск Xray / REALITY")
        if (config.isBlank()) {
            failAndStop("Xray профиль не передан")
            return
        }

        Thread {
            activeBackend?.disconnect()
            val backend = XrayRealityBackend(config)
            activeBackend = backend
            backend.connect(this)
                .onSuccess {
                    publishState(true, "Подключено через Xray / REALITY")
                    getSystemService(NotificationManager::class.java)
                        .notify(NOTIFICATION_ID, buildNotification("XFreedom подключён · REALITY"))
                }
                .onFailure { error ->
                    activeBackend = null
                    failAndStop("REALITY: ${error.message ?: "ошибка подключения"}")
                }
        }.start()
    }

    private fun stopTunnel(message: String) {
        Thread {
            activeBackend?.disconnect()
            activeBackend = null
            publishState(false, message)
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }.start()
    }

    private fun failAndStop(message: String) {
        publishState(false, message)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun startForegroundNow(text: String) {
        val notification = buildNotification(text)
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
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

    private fun publishState(connected: Boolean, message: String) {
        getSharedPreferences(PREFS, MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_CONNECTED, connected)
            .putString(KEY_MESSAGE, message)
            .apply()

        sendBroadcast(
            Intent(ACTION_STATUS)
                .setPackage(packageName)
                .putExtra(EXTRA_CONNECTED, connected)
                .putExtra(EXTRA_MESSAGE, message),
        )
    }

    companion object {
        const val ACTION_START_XRAY = "app.xservis.xfreedom.action.START_XRAY"
        const val ACTION_STOP = "app.xservis.xfreedom.action.STOP_VPN"
        const val ACTION_STATUS = "app.xservis.xfreedom.action.VPN_STATUS"
        const val EXTRA_XRAY_CONFIG = "xray_config"
        const val EXTRA_CONNECTED = "connected"
        const val EXTRA_MESSAGE = "message"

        const val PREFS = "xfreedom_vpn_runtime"
        const val KEY_CONNECTED = "connected"
        const val KEY_MESSAGE = "message"

        private const val CHANNEL_ID = "xfreedom_vpn"
        private const val NOTIFICATION_ID = 1042
    }
}
