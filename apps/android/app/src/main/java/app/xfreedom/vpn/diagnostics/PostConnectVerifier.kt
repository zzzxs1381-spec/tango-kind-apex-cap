package app.xfreedom.vpn.diagnostics

import java.net.HttpURLConnection
import java.net.URL

object PostConnectVerifier {
    private val endpoints = listOf(
        "https://cp.cloudflare.com/generate_204",
        "https://www.gstatic.com/generate_204",
    )

    data class Result(
        val endpoint: String,
        val statusCode: Int,
    )

    fun verify(): kotlin.Result<Result> = runCatching {
        var lastError: Throwable? = null
        for (endpoint in endpoints) {
            try {
                val connection = URL(endpoint).openConnection() as HttpURLConnection
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 6_000
                connection.readTimeout = 6_000
                connection.requestMethod = "GET"
                connection.setRequestProperty("Cache-Control", "no-cache")
                try {
                    val code = connection.responseCode
                    if (code in 200..399) return@runCatching Result(endpoint, code)
                    lastError = IllegalStateException("Verification endpoint returned HTTP $code")
                } finally {
                    connection.disconnect()
                }
            } catch (error: Throwable) {
                lastError = error
            }
        }
        throw lastError ?: IllegalStateException("No verification endpoint succeeded")
    }
}
