package app.xservis.xfreedom.config

data class Hysteria2Profile(
    val server: String,
    val port: Int,
    val password: String,
    val serverName: String,
    val obfsPassword: String? = null,
    val certificatePinsSha256: List<String> = emptyList(),
)

data class TuicProfile(
    val server: String,
    val port: Int,
    val uuid: String,
    val password: String,
    val serverName: String,
    val congestionControl: String = "cubic",
    val udpRelayMode: String = "native",
    val heartbeat: String = "10s",
    val certificatePinsSha256: List<String> = emptyList(),
)

data class RealityProfile(
    val server: String,
    val port: Int,
    val uuid: String,
    val serverName: String,
    val publicKey: String,
    val shortId: String,
)

object ProfileGenerators {
    fun hysteria2(profile: Hysteria2Profile): String {
        require(profile.port in 1..65535)
        require(profile.serverName.isNotBlank())
        require(profile.password.isNotBlank())

        val obfs = profile.obfsPassword?.takeIf { it.isNotBlank() }?.let {
            ",\n    \"obfs\": {\"type\": \"salamander\", \"password\": \"${escape(it)}\"}"
        }.orEmpty()

        return """
            {
              "type": "hysteria2",
              "tag": "xf-hysteria2",
              "server": "${escape(profile.server)}",
              "server_port": ${profile.port},
              "password": "${escape(profile.password)}"$obfs,
              "tls": ${tls(profile.serverName, profile.certificatePinsSha256)}
            }
        """.trimIndent()
    }

    fun tuic(profile: TuicProfile): String {
        require(profile.port in 1..65535)
        require(profile.congestionControl in setOf("cubic", "new_reno", "bbr"))
        require(profile.udpRelayMode in setOf("native", "quic"))
        require(profile.uuid.isNotBlank())
        require(profile.password.isNotBlank())
        require(profile.serverName.isNotBlank())

        return """
            {
              "type": "tuic",
              "tag": "xf-tuic",
              "server": "${escape(profile.server)}",
              "server_port": ${profile.port},
              "uuid": "${escape(profile.uuid)}",
              "password": "${escape(profile.password)}",
              "congestion_control": "${profile.congestionControl}",
              "udp_relay_mode": "${profile.udpRelayMode}",
              "zero_rtt_handshake": false,
              "heartbeat": "${escape(profile.heartbeat)}",
              "tls": ${tls(profile.serverName, profile.certificatePinsSha256)}
            }
        """.trimIndent()
    }

    fun reality(profile: RealityProfile): String {
        require(profile.port in 1..65535)
        require(profile.uuid.isNotBlank())
        require(profile.serverName.isNotBlank())
        require(profile.publicKey.isNotBlank())
        require(profile.shortId.isNotBlank())

        return """
            {
              "type": "vless",
              "tag": "xf-reality",
              "server": "${escape(profile.server)}",
              "server_port": ${profile.port},
              "uuid": "${escape(profile.uuid)}",
              "flow": "xtls-rprx-vision",
              "tls": {
                "enabled": true,
                "server_name": "${escape(profile.serverName)}",
                "insecure": false,
                "utls": {"enabled": true, "fingerprint": "chrome"},
                "reality": {
                  "enabled": true,
                  "public_key": "${escape(profile.publicKey)}",
                  "short_id": "${escape(profile.shortId)}"
                }
              }
            }
        """.trimIndent()
    }

    private fun tls(serverName: String, pins: List<String>): String {
        val pinField = if (pins.isEmpty()) {
            ""
        } else {
            val values = pins.joinToString(",") { "\"${escape(it)}\"" }
            ",\"certificate_public_key_sha256\":[$values]"
        }
        return "{\"enabled\":true,\"server_name\":\"${escape(serverName)}\",\"insecure\":false$pinField}"
    }

    private fun escape(value: String): String = buildString(value.length + 8) {
        value.forEach { ch ->
            when (ch) {
                '\\' -> append("\\\\")
                '"' -> append("\\\"")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> append(ch)
            }
        }
    }
}
