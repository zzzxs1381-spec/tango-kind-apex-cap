package app.xfreedom.vpn.engine.xray

import android.content.Context
import app.xfreedom.vpn.engine.TunnelEngine
import libXray.DialerController
import libXray.LibXray
import org.json.JSONObject

class XrayEngine(
    private val protectSocket: (Int) -> Boolean,
) : TunnelEngine {
    override val id: String = "xray"
    override val displayName: String = "Xray / VLESS REALITY"

    override fun isReady(context: Context): Boolean = runCatching {
        invoke("xrayVersion")
        true
    }.getOrDefault(false)

    override fun validate(context: Context, config: String): Result<Unit> = runCatching {
        invoke("testXray", JSONObject().put("xrayJson", config))
    }

    override fun start(context: Context, tunFd: Int, config: String): Result<Unit> = runCatching {
        val controller = DialerController { fd -> protectSocket(fd.toInt()) }
        LibXray.registerDialerController(controller)
        LibXray.registerListenerController(controller)

        val runtimeConfig = XrayConfig.forTun(config, tunFd)
        invoke("testXray", JSONObject().put("xrayJson", runtimeConfig))
        invoke("runXray", JSONObject().put("xrayJson", runtimeConfig))

        val state = invoke("getXrayState")
        check(state.optBoolean("running", state.optBoolean("state", true))) {
            "libXray did not enter running state"
        }
    }

    override fun stop(context: Context): Result<Unit> = runCatching {
        invoke("stopXray")
    }

    private fun invoke(method: String, payload: JSONObject? = null): JSONObject {
        val request = JSONObject()
            .put("apiVersion", 3)
            .put("method", method)
        if (payload != null) request.put("payload", payload)

        val raw = LibXray.invoke(request.toString())
        val response = JSONObject(raw)
        if (!response.optBoolean("success", false)) {
            val error = response.optString("error").ifBlank { "Unknown libXray error" }
            error("libXray $method failed: $error")
        }

        return when (val data = response.opt("data")) {
            is JSONObject -> data
            null, JSONObject.NULL -> JSONObject()
            else -> JSONObject().put("value", data)
        }
    }
}
