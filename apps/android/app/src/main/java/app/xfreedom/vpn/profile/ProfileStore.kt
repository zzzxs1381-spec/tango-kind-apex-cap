package app.xfreedom.vpn.profile

import android.content.Context
import org.json.JSONObject
import java.io.File

/** Stores client-only Xray JSON in app-private storage. */
object ProfileStore {
    private const val PROFILE_FILE = "active-xray-client.json"

    fun hasProfile(context: Context): Boolean = profileFile(context).isFile

    fun read(context: Context): Result<String> = runCatching {
        val file = profileFile(context)
        require(file.isFile) { "No Xray client profile imported" }
        file.readText(Charsets.UTF_8)
    }

    fun importClientJson(context: Context, rawJson: String): Result<Unit> = runCatching {
        val parsed = JSONObject(rawJson)
        validateClientOnly(parsed)
        val normalized = parsed.toString()
        val target = profileFile(context)
        val temporary = File(target.parentFile, target.name + ".tmp")
        temporary.writeText(normalized, Charsets.UTF_8)
        if (!temporary.renameTo(target)) {
            target.writeText(normalized, Charsets.UTF_8)
            temporary.delete()
        }
    }

    fun clear(context: Context) {
        profileFile(context).delete()
    }

    private fun validateClientOnly(root: JSONObject) {
        val outbounds = root.optJSONArray("outbounds")
        require(outbounds != null && outbounds.length() > 0) {
            "Client profile must contain at least one outbound"
        }

        // A server-side REALITY private key must never be present in a mobile profile.
        val serialized = root.toString()
        require(!serialized.contains("\"privateKey\"", ignoreCase = true)) {
            "Profile contains a privateKey field and was rejected"
        }

        // Imported inbounds are ignored at runtime, but reject transparent/server
        // listeners here so accidental server configs do not get persisted as clients.
        val inbounds = root.optJSONArray("inbounds")
        if (inbounds != null) {
            for (index in 0 until inbounds.length()) {
                val inbound = inbounds.optJSONObject(index) ?: continue
                val protocol = inbound.optString("protocol")
                require(protocol.equals("socks", ignoreCase = true) ||
                    protocol.equals("http", ignoreCase = true)) {
                    "Only client-side socks/http inbounds may be imported"
                }
            }
        }
    }

    private fun profileFile(context: Context): File = File(context.filesDir, PROFILE_FILE)
}
