package app.xservis.xfreedom.tls

import android.net.VpnService
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import kotlin.random.Random

enum class TunnelStage { IDLE, PREPARING, DIAGNOSING, SELECTING_ROUTE, CONNECTING, HANDSHAKING, TUNNEL_UP, VERIFYING, CONNECTED, DEGRADED, FAILING_OVER, RECONNECTING, OFFLINE, ERROR }
interface TunnelEngine {
    fun start()
    fun stop()
    fun restart()
    fun status():TunnelStage
    fun health():Boolean
    fun stats():Pair<Long,Long>
    fun migrate()
}
class TlsTunnelEngine(private val service:VpnService,private val notify:(TunnelStage,TunnelEvidence)->Unit):TunnelEngine {
    private val executor=java.util.concurrent.ScheduledThreadPoolExecutor(1).apply { setExecuteExistingDelayedTasksAfterShutdownPolicy(false) }
    private val bridge=PacketBridge(service)
    private var client:XfTlsClient?=null
    private var socks:LoopbackSocks?=null
    private var api:NativeApi?=null
    private var profile:NativeProfile?=null
    private var generation=0L
    private var sequence=0L
    private var failures=0
    @Volatile private var stage=TunnelStage.IDLE
    @Volatile private var enabled=false
    private val requested=AtomicLong()
    private fun emit(next:TunnelStage,evidence:TunnelEvidence=TunnelEvidence()) {
        stage=next;notify(next,evidence)
        api?.stage(JSONObject().put("generation",generation).put("sequence",++sequence).put("stage",next.name).put("evidence",evidence.json()))
    }
    override fun status()=stage
    override fun health()=enabled && bridge.health()
    override fun stats()=client?.stats()?: (0L to 0L)
    override fun start() {
        if(enabled)return
        enabled=true
        val ticket=requested.incrementAndGet()
        executor.execute { connect(ticket) }
    }
    private fun current(ticket:Long)=enabled && requested.get()==ticket
    private fun connect(ticket:Long) {
        if(!current(ticket))return
        generation=System.currentTimeMillis();sequence=0
        try {
            emit(TunnelStage.PREPARING)
            if(api==null) {
                val enrollment=SecureEnrollment.load(service)?:error("Свяжите устройство с кабинетом")
                api=NativeApi(enrollment.getString("apiOrigin").trimEnd('/'),enrollment.getString("probeToken"))
                
            }
            if(profile==null) profile=api!!.config()
            emit(TunnelStage.DIAGNOSING)
            val route=profile?:error("Нет подтверждённого рецепта")
            check(route.expiresAt>System.currentTimeMillis()/1000){"Профиль истёк: требуется повторная привязка"}
            emit(TunnelStage.SELECTING_ROUTE)
            bridge.pause();socks?.close();client?.close()
            if(!current(ticket))return
            emit(TunnelStage.CONNECTING)
            val next=XfTlsClient(service,route);client=next
            emit(TunnelStage.HANDSHAKING)
            next.check()
            if(!current(ticket))return
            socks=LoopbackSocks(next)
            bridge.establish()
            emit(TunnelStage.TUNNEL_UP,TunnelEvidence(tunInterfaceUp=true))
            bridge.start(socks!!)
            emit(TunnelStage.VERIFYING)
            val evidence=VpnVerifier.verify(service,route.apiOrigin,bridge.interfaceUp(),bridge::health)
            if(!current(ticket))return
            check(evidence.connected){"Интернет через VPN не подтверждён"}
            failures=0;emit(TunnelStage.CONNECTED,evidence)
            executor.schedule({monitor(ticket)},20,TimeUnit.SECONDS)
        } catch(_:Exception) {
            if(!current(ticket))return
            bridge.pause();socks?.close();socks=null;client?.close();client=null
            emit(TunnelStage.ERROR)
            scheduleRetry(ticket)
        }
    }
    private fun monitor(ticket:Long) {
        if(!current(ticket))return
        val route=profile?:return
        val evidence=VpnVerifier.verify(service,route.apiOrigin,bridge.interfaceUp(),bridge::health)
        if(!current(ticket))return
        if(evidence.connected) {
            emit(TunnelStage.CONNECTED,evidence)
            executor.schedule({monitor(ticket)},20,TimeUnit.SECONDS)
        }else {
            emit(TunnelStage.DEGRADED,evidence)
            scheduleRetry(ticket)
        }
    }
    private fun scheduleRetry(ticket:Long) {
        if(!current(ticket))return
        failures++
        emit(TunnelStage.RECONNECTING)
        val delay=minOf(60L,1L shl minOf(failures,6))+Random.nextLong(0,3)
        executor.schedule({connect(ticket)},delay,TimeUnit.SECONDS)
    }
    override fun migrate() {
        if(!enabled)return
        val ticket=requested.incrementAndGet()
        // Interrupt protected sockets immediately; serialize core replacement on the worker.
        client?.close()
        executor.execute {if(current(ticket)){emit(TunnelStage.RECONNECTING);connect(ticket)}}
    }
    override fun restart()=migrate()
    override fun stop() {
        enabled=false;requested.incrementAndGet();client?.close()
        executor.execute {
            bridge.close();socks?.close();socks=null;client=null
            emit(TunnelStage.IDLE);api?.close();api=null
        }
        executor.shutdown()
        executor.awaitTermination(25,TimeUnit.SECONDS)
    }
}
