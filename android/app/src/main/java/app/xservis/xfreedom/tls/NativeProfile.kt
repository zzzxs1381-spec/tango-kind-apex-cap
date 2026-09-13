package app.xservis.xfreedom.tls

import org.json.JSONObject
import android.util.Base64
import java.net.URI

data class NativeProfile(
    val sessionId: String, val expiresAt: Long, val apiOrigin: String,
    val host: String, val port: Int, val sni: String, val pin: ByteArray, val authToken: String,
) {
    companion object {
        fun parse(json: JSONObject, expectedOrigin: String): NativeProfile {
            require(json.getInt("version") == 1 && json.getString("protocol") == "TLS13_SNI")
            val origin = json.getString("apiOrigin").trimEnd('/')
            require(origin == expectedOrigin.trimEnd('/')) { "API origin изменён" }
            val uri = URI(origin)
            require(uri.scheme == "https" && uri.host != null && uri.userInfo == null && uri.rawQuery == null && uri.rawFragment == null && uri.path.orEmpty().isEmpty())
            val caps = json.getJSONObject("capabilities")
            require(caps.getBoolean("tcp") && !caps.getBoolean("udp") && !caps.getBoolean("ipv6") && caps.getBoolean("avoidUdp"))
            val edge = json.getJSONObject("endpoint")
            val host = edge.getString("host")
            val parts = host.split('.').map { it.toIntOrNull() ?: -1 }
            require(parts.size == 4 && parts.all { it in 0..255 }) { "Edge должен иметь буквальный IPv4" }
            val port = edge.getInt("port"); require(port in 1..65535)
            val pinText = edge.getString("pin"); require(pinText.startsWith("sha256/"))
            val pin = Base64.decode(pinText.removePrefix("sha256/"), Base64.NO_WRAP); require(pin.size == 32)
            val token = edge.getString("authToken"); require(token.length in 32..4000 && token.matches(Regex("[A-Za-z0-9_.-]+")))
            val sni = edge.getString("sni"); require(sni.matches(Regex("[a-zA-Z0-9.-]{1,253}")))
            val expiry = json.getLong("expiresAt"); require(expiry > System.currentTimeMillis()/1000)
            return NativeProfile(json.getString("sessionId"), expiry, origin, host, port, sni, pin, token)
        }
    }
}
