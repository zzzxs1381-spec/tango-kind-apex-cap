package app.xservis.xfreedom.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import app.xservis.xfreedom.MainActivity
import app.xservis.xfreedom.tls.TlsTunnelEngine
import app.xservis.xfreedom.tls.TunnelStage
import app.xservis.xfreedom.tls.TunnelEvidence
import app.xservis.xfreedom.tls.VpnVerifier
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

class XFreedomVpnService : VpnService() {
    private val worker=Executors.newSingleThreadScheduledExecutor()
    private val epoch=AtomicLong()
    @Volatile private var activeBackend:XrayRealityBackend?=null
    @Volatile private var nativeEngine:TlsTunnelEngine?=null
    @Volatile private var lastStage=TunnelStage.IDLE
    @Volatile private var lastEvidence=TunnelEvidence()
    override fun onCreate() {
        super.onCreate()
        getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL_ID,"XFreedom VPN",NotificationManager.IMPORTANCE_LOW))
        publish(TunnelStage.IDLE)
    }
    override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
        when(intent?.action) {
            ACTION_STOP -> {
                if(Build.VERSION.SDK_INT>=29 && isAlwaysOn) return START_STICKY
                epoch.incrementAndGet()
                worker.execute {stopEngines();publish(TunnelStage.IDLE);stopForeground(STOP_FOREGROUND_REMOVE);stopSelf()}
            }
            ACTION_QUERY -> {publish(lastStage,lastEvidence);if(nativeEngine==null && activeBackend==null)stopSelf()}
            ACTION_START_XRAY -> {
                foreground("Подготовка подключения")
                val ticket=epoch.incrementAndGet()
                val config=intent.getStringExtra(EXTRA_XRAY_CONFIG).orEmpty()
                worker.execute {
                    stopEngines();publish(TunnelStage.CONNECTING)
                    val backend=XrayRealityBackend(config);activeBackend=backend
                    backend.connect(this).onSuccess {
                        if(ticket!=epoch.get()){backend.disconnect();return@onSuccess}
                        publish(TunnelStage.TUNNEL_UP,TunnelEvidence(tunInterfaceUp=true))
                        verifyXray(ticket)
                    }.onFailure {activeBackend=null;publish(TunnelStage.ERROR)}
                }
            }
            ACTION_START_TLS, ACTION_START, null -> {
                foreground("Подготовка подключения")
                val ticket=epoch.incrementAndGet()
                worker.execute {
                    stopEngines()
                    if(ticket==epoch.get()) {
                        val engine=TlsTunnelEngine(this){stage,evidence->if(ticket==epoch.get())publish(stage,evidence)}
                        nativeEngine=engine;engine.start()
                    }
                }
            }
            else -> {publish(TunnelStage.ERROR);stopSelf()}
        }
        return if(intent?.action==ACTION_START_XRAY) Service.START_NOT_STICKY else Service.START_STICKY
    }
    private fun verifyXray(ticket:Long) {
        if(ticket!=epoch.get())return
        val backend=activeBackend?:return
        publish(TunnelStage.VERIFYING)
        val evidence=VpnVerifier.verify(this,"https://xservis.app",backend.interfaceUp(),backend::health)
        if(ticket!=epoch.get())return
        publish(if(evidence.connected)TunnelStage.CONNECTED else TunnelStage.DEGRADED,evidence)
        worker.schedule({verifyXray(ticket)},20,TimeUnit.SECONDS)
    }
    private fun stopEngines(){nativeEngine?.stop();nativeEngine=null;activeBackend?.disconnect();activeBackend=null}
    override fun onRevoke() {
        epoch.incrementAndGet();worker.execute{stopEngines();publish(TunnelStage.IDLE);stopForeground(STOP_FOREGROUND_REMOVE);stopSelf()}
        super.onRevoke()
    }
    override fun onDestroy() {
        epoch.incrementAndGet();worker.execute{stopEngines()};worker.shutdown()
        super.onDestroy()
    }
    private fun foreground(text:String) {
        if(Build.VERSION.SDK_INT>=34)startForeground(NOTIFICATION_ID,notification(text),ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(NOTIFICATION_ID,notification(text))
    }
    private fun notification(text:String):Notification=Notification.Builder(this,CHANNEL_ID)
        .setContentTitle("XFreedom").setContentText(text).setOngoing(true)
        .setSmallIcon(android.R.drawable.stat_sys_download_done)
        .setContentIntent(PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        .build()
    private fun publish(stage:TunnelStage,evidence:TunnelEvidence=TunnelEvidence()) {
        val connected=stage==TunnelStage.CONNECTED && evidence.connected
        val safeStage=if(stage==TunnelStage.CONNECTED && !connected)TunnelStage.VERIFYING else stage
        lastStage=safeStage;lastEvidence=evidence
        val message=stageLabel(safeStage)
        getSharedPreferences(PREFS,MODE_PRIVATE).edit().putBoolean(KEY_CONNECTED,connected).putString(KEY_MESSAGE,message)
            .putString(EXTRA_STAGE,safeStage.name).putLong("checked_at",System.currentTimeMillis()).apply()
        sendBroadcast(Intent(ACTION_STATUS).setPackage(packageName).putExtra(EXTRA_CONNECTED,connected)
            .putExtra(EXTRA_MESSAGE,message).putExtra(EXTRA_STAGE,safeStage.name))
        if(safeStage!=TunnelStage.IDLE)getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID,notification(message))
    }
    companion object {
        const val ACTION_START="app.xservis.xfreedom.action.START_VPN"
        const val ACTION_START_TLS="app.xservis.xfreedom.action.START_TLS"
        const val ACTION_START_XRAY="app.xservis.xfreedom.action.START_XRAY"
        const val ACTION_STOP="app.xservis.xfreedom.action.STOP_VPN"
        const val ACTION_QUERY="app.xservis.xfreedom.action.QUERY_VPN"
        const val ACTION_STATUS="app.xservis.xfreedom.action.VPN_STATUS"
        const val EXTRA_XRAY_CONFIG="xray_config"
        const val EXTRA_CONNECTED="connected"
        const val EXTRA_MESSAGE="message"
        const val EXTRA_STAGE="stage"
        const val PREFS="xfreedom_vpn_runtime"
        const val KEY_CONNECTED="connected"
        const val KEY_MESSAGE="message"
        private const val CHANNEL_ID="xfreedom_vpn"
        private const val NOTIFICATION_ID=1042
        fun stageLabel(stage:TunnelStage)=when(stage){
            TunnelStage.IDLE->"Не подключено"
            TunnelStage.PREPARING->"Подготовка"
            TunnelStage.DIAGNOSING->"Проверяем сеть"
            TunnelStage.SELECTING_ROUTE->"Выбираем маршрут"
            TunnelStage.CONNECTING->"Устанавливаем соединение"
            TunnelStage.HANDSHAKING->"Проверяем защищённый канал"
            TunnelStage.TUNNEL_UP->"Туннель поднят · проверяем интернет"
            TunnelStage.VERIFYING->"Проверяем DNS и интернет"
            TunnelStage.CONNECTED->"Подключено · интернет проверен"
            TunnelStage.DEGRADED->"Соединение требует проверки"
            TunnelStage.FAILING_OVER->"Меняем маршрут"
            TunnelStage.RECONNECTING->"Восстанавливаем соединение"
            TunnelStage.OFFLINE->"Сеть недоступна"
            TunnelStage.ERROR->"Подключение не подтверждено"
        }
    }
}
