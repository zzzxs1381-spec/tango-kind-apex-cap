package app.xservis.xfreedom.vpn

import android.net.VpnService
import android.os.ParcelFileDescriptor
import libXray.DialerController
import libXray.LibXray
import org.json.JSONArray
import org.json.JSONObject

/**
 * Native Xray-core backend using Xray's Android TUN inbound.
 *
 * The caller supplies the client Xray JSON (for example the server-generated
 * xray-client.json). XFreedom replaces proxy/listener inbounds with one Android
 * TUN inbound and injects the VpnService fd through xray.tun.fd, as documented
 * by Xray-core. Outbound sockets are protected from the VPN route to prevent a
 * recursive tunnel loop.
 */
class XrayRealityBackend(private val sourceConfig: String) : TunnelBackend {
    override val id: String = "xray-reality"
    override val ready: Boolean = sourceConfig.isNotBlank()

    private var vpnInterface: ParcelFileDescriptor? = null
    private var running = false

    override fun connect(service: VpnService): Result<Unit> = runCatching {
        check(!running) { "Xray is already running" }
        require(sourceConfig.toByteArray(Charsets.UTF_8).size <= MAX_CONFIG_BYTES) {
            "Xray profile is too large"
        }

        val profile = JSONObject(sourceConfig)
        val outbounds = profile.optJSONArray("outbounds")
        require(outbounds != null && outbounds.length() > 0) { "Xray profile has no outbounds" }

        val pfd = service.Builder()
            .setSession("XFreedom · REALITY")
            .setMtu(MTU)
            .addAddress("172.31.255.2", 30)
            .addAddress("fdfe:dcba:9876::2", 126)
            .addDnsServer("1.1.1.1")
            .addDnsServer("2606:4700:4700::1111")
            .addRoute("0.0.0.0", 0)
            .addRoute("::", 0)
            .establish()
            ?: error("Android VPN interface was not established")

        vpnInterface = pfd

        val runtimeConfig = buildRuntimeConfig(profile, pfd.fd)
        val controller = object : DialerController {
            override fun protectFd(fd: Int): Boolean = service.protect(fd)
        }
        LibXray.registerDialerController(controller)
        LibXray.registerListenerController(controller)

        val response = invoke("runXray", JSONObject().put("xrayJson", runtimeConfig.toString()))
        check(response.optBoolean("success")) {
            response.optString("error").ifBlank { "libXray rejected the configuration" }
        }

        val state = invoke("getXrayState", JSONObject())
        check(state.optBoolean("success") && state.optJSONObject("data")?.optBoolean("running") == true) {
            "Xray did not enter running state"
        }
        running = true
    }.onFailure {
        stopCore()
        vpnInterface?.close()
        vpnInterface = null
    }

    override fun disconnect() {
        stopCore()
        vpnInterface?.close()
        vpnInterface = null
        running = false
    }

    private fun stopCore() {
        runCatching { invoke("stopXray", JSONObject()) }
    }

    private fun buildRuntimeConfig(profile: JSONObject, tunFd: Int): JSONObject {
        val root = JSONObject(profile.toString())

        val env = root.optJSONObject("env") ?: JSONObject()
        env.put("xray.tun.fd", tunFd.toString())
        root.put("env", env)

        root.put(
            "inbounds",
            JSONArray().put(
                JSONObject()
                    .put("tag", "xf-tun")
                    .put("port", 0)
                    .put("protocol", "tun")
                    .put(
                        "settings",
                        JSONObject()
                            .put("name", "xfreedom0")
                            .put("mtu", MTU),
                    ),
            ),
        )

        val log = root.optJSONObject("log") ?: JSONObject()
        log.put("loglevel", "warning")
        log.put("access", "none")
        root.put("log", log)

        return root
    }

    private fun invoke(method: String, payload: JSONObject): JSONObject {
        val request = JSONObject()
            .put("apiVersion", 3)
            .put("method", method)
            .put("payload", payload)
        return JSONObject(LibXray.invoke(request.toString()))
    }

    private companion object {
        const val MTU = 1280
        const val MAX_CONFIG_BYTES = 256 * 1024
    }
}
