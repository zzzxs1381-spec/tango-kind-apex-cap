package app.xservis.xfreedom.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

class SystemProbeEngine(private val context: Context) {
    private data class Target(val id: String, val host: String, val url: String)

    private val targets = listOf(
        Target("whatsapp", "web.whatsapp.com", "https://web.whatsapp.com/"),
        Target("tiktok", "www.tiktok.com", "https://www.tiktok.com/"),
        Target("youtube", "www.youtube.com", "https://www.youtube.com/generate_204"),
        Target("instagram", "www.instagram.com", "https://www.instagram.com/"),
        Target("telegram", "telegram.org", "https://telegram.org/"),
    )

    fun collect(): NetworkSnapshot {
        val control = ControlProbe(
            dns = probeDns("cloudflare.com"),
            tcp443 = probeTcp("1.1.1.1", 443),
            tls = probeTls("cloudflare.com", "1.1.1.1"),
            // Generic UDP/443 and QUIC are deliberately UNKNOWN until a real
            // QUIC-capable engine is integrated. A single blind datagram is not
            // evidence that QUIC works or is blocked.
            udp443 = ProbeState.UNKNOWN,
            quic = ProbeState.UNKNOWN,
        )

        return NetworkSnapshot(
            observedAtEpochMs = System.currentTimeMillis(),
            accessType = currentAccessType(),
            control = control,
            apps = targets.map { target ->
                AppProbe(
                    id = target.id,
                    dns = probeDns(target.host),
                    tcp443 = probeTcp(target.host, 443),
                    tls = probeTls(target.host, target.host),
                    http = probeHttp(target.url),
                )
            },
        )
    }

    private fun currentAccessType(): AccessType {
        val manager = context.getSystemService(ConnectivityManager::class.java)
        val network = manager.activeNetwork ?: return AccessType.UNKNOWN
        val caps = manager.getNetworkCapabilities(network) ?: return AccessType.UNKNOWN
        return when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> AccessType.WIFI
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> AccessType.MOBILE
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> AccessType.ETHERNET
            else -> AccessType.UNKNOWN
        }
    }

    private fun probeDns(host: String): ProbeState = runProbe {
        check(InetAddress.getAllByName(host).isNotEmpty())
    }

    private fun probeTcp(host: String, port: Int): ProbeState = runProbe {
        Socket().use { socket ->
            socket.connect(InetSocketAddress(host, port), TIMEOUT_MS)
        }
    }

    private fun probeTls(serverName: String, connectHost: String): ProbeState = runProbe {
        Socket().use { raw ->
            raw.connect(InetSocketAddress(connectHost, 443), TIMEOUT_MS)
            raw.soTimeout = TIMEOUT_MS
            val factory = SSLSocketFactory.getDefault() as SSLSocketFactory
            (factory.createSocket(raw, serverName, 443, true) as SSLSocket).use { tls ->
                tls.soTimeout = TIMEOUT_MS
                val parameters = tls.sslParameters
                parameters.endpointIdentificationAlgorithm = "HTTPS"
                tls.sslParameters = parameters
                tls.startHandshake()
                check(tls.session.protocol.isNotBlank())
            }
        }
    }

    private fun probeHttp(url: String): ProbeState = runProbe {
        val connection = URL(url).openConnection() as HttpsURLConnection
        try {
            connection.instanceFollowRedirects = true
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.requestMethod = "GET"
            connection.setRequestProperty("Range", "bytes=0-0")
            connection.setRequestProperty("User-Agent", "XFreedom-NetworkProbe/0.1")
            connection.connect()
            val status = connection.responseCode
            check(status in 100..599 && status != HttpURLConnection.HTTP_CLIENT_TIMEOUT)
        } finally {
            connection.disconnect()
        }
    }

    private inline fun runProbe(block: () -> Unit): ProbeState = try {
        block()
        ProbeState.PASS
    } catch (_: Exception) {
        ProbeState.FAIL
    }

    private companion object {
        const val TIMEOUT_MS = 3_500
    }
}
