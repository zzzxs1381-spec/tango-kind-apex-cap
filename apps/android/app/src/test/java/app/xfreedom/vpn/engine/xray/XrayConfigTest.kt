package app.xfreedom.vpn.engine.xray

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class XrayConfigTest {
    @Test
    fun `replaces imported listener with tun and preserves outbound`() {
        val imported = """
            {
              "log":{"loglevel":"warning"},
              "inbounds":[{
                "listen":"127.0.0.1",
                "port":10808,
                "protocol":"socks",
                "settings":{"udp":true}
              }],
              "outbounds":[{
                "protocol":"vless",
                "settings":{"vnext":[{"address":"203.0.113.7","port":443,"users":[{"id":"00000000-0000-0000-0000-000000000001","encryption":"none","flow":"xtls-rprx-vision"}]}]},
                "streamSettings":{"network":"raw","security":"reality","realitySettings":{"serverName":"example.com","fingerprint":"chrome","password":"public-key","shortId":"0011223344556677"}}
              }]
            }
        """.trimIndent()

        val runtime = JSONObject(XrayConfig.forTun(imported, tunFd = 77, mtu = 1280))

        assertEquals("77", runtime.getJSONObject("env").getString("xray.tun.fd"))
        val inbounds = runtime.getJSONArray("inbounds")
        assertEquals(1, inbounds.length())
        assertEquals("tun", inbounds.getJSONObject(0).getString("protocol"))
        assertEquals(1280, inbounds.getJSONObject(0).getJSONObject("settings").getInt("mtu"))
        assertEquals("vless", runtime.getJSONArray("outbounds").getJSONObject(0).getString("protocol"))
        assertFalse(runtime.toString().contains("\"protocol\":\"socks\""))
        assertTrue(runtime.toString().contains("xtls-rprx-vision"))
    }
}
