package app.xfreedom.vpn.engine.xray

import org.json.JSONArray
import org.json.JSONObject

object XrayConfig {
    fun forTun(importedClientJson: String, tunFd: Int, mtu: Int = 1280): String {
        val imported = JSONObject(importedClientJson)
        val outbounds = imported.optJSONArray("outbounds")
            ?: error("Xray client profile has no outbounds")
        require(outbounds.length() > 0) { "Xray client profile has no outbounds" }

        val root = JSONObject()
        root.put("log", imported.optJSONObject("log") ?: JSONObject().put("loglevel", "warning"))
        root.put("env", JSONObject().put("xray.tun.fd", tunFd.toString()))
        root.put(
            "inbounds",
            JSONArray().put(
                JSONObject()
                    .put("tag", "xfreedom-tun")
                    .put("port", 0)
                    .put("protocol", "tun")
                    .put(
                        "settings",
                        JSONObject()
                            .put("name", "xfreedom0")
                            .put("mtu", mtu),
                    ),
            ),
        )
        root.put("outbounds", JSONArray(outbounds.toString()))

        imported.optJSONObject("dns")?.let { root.put("dns", JSONObject(it.toString())) }
        imported.optJSONObject("routing")?.let { root.put("routing", JSONObject(it.toString())) }
        imported.optJSONObject("policy")?.let { root.put("policy", JSONObject(it.toString())) }
        imported.optJSONObject("stats")?.let { root.put("stats", JSONObject(it.toString())) }

        return root.toString()
    }
}
