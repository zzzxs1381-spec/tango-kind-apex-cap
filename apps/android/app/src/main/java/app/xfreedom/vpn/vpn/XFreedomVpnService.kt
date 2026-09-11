package app.xfreedom.vpn.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import app.xfreedom.vpn.MainActivity
import app.xfreedom.vpn.diagnostics.PostConnectVerifier
import app.xfreedom.vpn.engine.TunnelEngine
import app.xfreedom.vpn.engine.xray.XrayEngine
import app.xfreedom.vpn.profile.ProfileStore

class XFreedomVpnService : VpnService() {
    @Volatile
    private var starting = false
    private var vpnInterface: ParcelFileDescriptor? = null
    private var activeEngine: TunnelEngine? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> stopVpnService()
            ACTION_START, null -> startVpnService()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        stopEngineAndTun()
        super.onDestroy()
    }

    override fun onRevoke() {
        broadcastState(STATE_DISCONNECTED, "VPN permission revoked by Android")
        stopVpnService()
        super.onRevoke()
    }

    private fun startVpnService() {
        ensureForeground()
        if (starting || vpnInterface != null) return
        starting = true
        broadcastState(STATE_STARTING, "Проверяем профиль и запускаем защищённый туннель…")

        Thread({ startWorker() }, "xfreedom-vpn-start").start()
    }

    private fun startWorker() {
        try {
            val profile = ProfileStore.read(this).getOrThrow()
            val engine = XrayEngine { fd -> protect(fd) }
            check(engine.isReady(this)) { "libXray is unavailable in this build" }
            engine.validate(this, profile).getOrThrow()

            val tun = Builder()
                .setSession("XFreedom")
                .setMtu(TUN_MTU)
                .addAddress("172.19.0.1", 30)
                .addRoute("0.0.0.0", 0)
                .addDnsServer("1.1.1.1")
                .addAddress("fd7a:115c:a1e0::1", 126)
                .addRoute("::", 0)
                .addDnsServer("2606:4700:4700::1111")
                .establish()
                ?: error("Android did not create the VPN interface")

            vpnInterface = tun
            activeEngine = engine
            engine.start(this, tun.fd, profile).getOrThrow()

            val verified = PostConnectVerifier.verify().getOrThrow()
            broadcastState(
                STATE_CONNECTED,
                "Туннель проверен через ${verified.endpoint} · HTTP ${verified.statusCode}",
            )
        } catch (error: Throwable) {
            stopEngineAndTun()
            broadcastState(
                STATE_ERROR,
                error.message ?: error.javaClass.simpleName,
            )
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        } finally {
            starting = false
        }
    }

    @Synchronized
    private fun stopEngineAndTun() {
        runCatching { activeEngine?.stop(this)?.getOrThrow() }
        activeEngine = null
        runCatching { vpnInterface?.close() }
        vpnInterface = null
    }

    private fun stopVpnService() {
        starting = false
        stopEngineAndTun()
        broadcastState(STATE_DISCONNECTED, "Отключено")
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
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("XFreedom")
            .setContentText("VPN запущен")
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

        const val STATE_STARTING = "STARTING"
        const val STATE_ENGINE_REQUIRED = "ENGINE_REQUIRED"
        const val STATE_CONNECTED = "CONNECTED"
        const val STATE_DISCONNECTED = "DISCONNECTED"
        const val STATE_ERROR = "ERROR"

        private const val TUN_MTU = 1280
        private const val CHANNEL_ID = "xfreedom_vpn"
        private const val NOTIFICATION_ID = 101
    }
}
