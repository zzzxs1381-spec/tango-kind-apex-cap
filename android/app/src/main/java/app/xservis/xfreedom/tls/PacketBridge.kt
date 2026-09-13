package app.xservis.xfreedom.tls

import android.net.VpnService
import android.os.ParcelFileDescriptor
import libXray.DialerController
import libXray.LibXray
import org.json.JSONArray
import org.json.JSONObject
import java.io.Closeable

/** Xray's pinned native TCP stack owns packet handling; no hand-written TCP emulation. */
class PacketBridge(private val service: VpnService) : Closeable {
    private var tun: ParcelFileDescriptor? = null
    private var coreFd: ParcelFileDescriptor? = null
    @Volatile private var running = false
    fun establish() {
        if(tun!=null) return
        tun=service.Builder().setSession("XFreedom · TLS")
            .setMtu(1280).addAddress("172.31.255.2",30)
            .addRoute("0.0.0.0",0).addDnsServer("1.1.1.1")
            // IPv6 is intentionally absent: Builder blocks an unconfigured address family.
            // No allowFamily, allowBypass or addDisallowedApplication.
            .establish() ?: error("TUN_INTERFACE_UP не подтверждён")
    }
    fun start(socks: LoopbackSocks) {
        val original=tun ?: error("TUN отсутствует")
        val duplicate=ParcelFileDescriptor.dup(original.fileDescriptor)
        val fd=duplicate.fd
        coreFd=duplicate
        check(!running)
        val controller=object:DialerController {
            override fun protectFd(fd:Long):Boolean = fd in 0..Int.MAX_VALUE.toLong() && service.protect(fd.toInt())
        }
        LibXray.registerDialerController(controller)
        LibXray.registerListenerController(controller)
        val root=buildConfig(fd,socks.port,socks.username,socks.password)
        val result=invoke("runXray",JSONObject().put("xrayJson",root.toString()))
        check(result.optBoolean("success")) { "Ядро отклонило PacketBridge" }
        running=true
        check(health()) { "PacketBridge не запущен" }
    }
    fun interfaceUp()=tun!=null
    fun health():Boolean = running && runCatching {
        val state=invoke("getXrayState",JSONObject())
        state.optBoolean("success") && state.optJSONObject("data")?.optBoolean("running")==true
    }.getOrDefault(false)
    /** Keep TUN fd alive while replacing the transport, so an outage cannot open a direct route. */
    fun pause() {
        if(running) runCatching { invoke("stopXray",JSONObject()) }
        running=false
        // Xray AndroidTun.Close is a no-op; the caller owns the fd lifetime.
        coreFd?.close();coreFd=null
    }
    override fun close() {pause();tun?.close();tun=null}
    private fun invoke(method:String,payload:JSONObject):JSONObject=JSONObject(LibXray.invoke(JSONObject().put("apiVersion",3).put("method",method).put("payload",payload).toString()))
    companion object {
        fun buildConfig(fd:Int,port:Int,user:String,password:String):JSONObject = JSONObject()
            .put("env",JSONObject().put("xray.tun.fd",fd.toString()))
            .put("log",JSONObject().put("loglevel","none").put("access","none"))
            .put("inbounds",JSONArray().put(JSONObject().put("tag","xf-tun").put("protocol","tun").put("port",0)
                .put("settings",JSONObject().put("name","xfreedom0").put("mtu",1280))))
            .put("dns",JSONObject().put("servers",JSONArray().put("tcp://1.1.1.1:53")).put("queryStrategy","UseIPv4"))
            .put("outbounds",JSONArray()
                .put(JSONObject().put("tag","xf-socks").put("protocol","socks").put("settings",JSONObject().put("servers",JSONArray().put(
                    JSONObject().put("address","127.0.0.1").put("port",port).put("users",JSONArray().put(JSONObject().put("user",user).put("pass",password)))))))
                .put(JSONObject().put("tag","xf-dns").put("protocol","dns").put("settings",JSONObject().put("rewriteNetwork","tcp").put("rewriteAddress","1.1.1.1").put("rewritePort",53).put("rules",JSONArray().put(JSONObject().put("action","direct"))))
                    .put("proxySettings",JSONObject().put("tag","xf-socks")))
                .put(JSONObject().put("tag","xf-drop").put("protocol","blackhole")))
            .put("routing",JSONObject().put("domainStrategy","AsIs").put("rules",JSONArray()
                .put(JSONObject().put("type","field").put("inboundTag",JSONArray().put("xf-tun")).put("port","53").put("outboundTag","xf-dns"))
                .put(JSONObject().put("type","field").put("network","udp").put("outboundTag","xf-drop"))
                .put(JSONObject().put("type","field").put("network","tcp").put("outboundTag","xf-socks"))))
    }
}
