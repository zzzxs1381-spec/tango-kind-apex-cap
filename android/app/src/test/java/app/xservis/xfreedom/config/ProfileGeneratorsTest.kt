package app.xservis.xfreedom.config

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProfileGeneratorsTest {
    @Test
    fun `hysteria2 never disables certificate verification`() {
        val json = ProfileGenerators.hysteria2(
            Hysteria2Profile(
                server = "203.0.113.10",
                port = 443,
                password = "secret",
                serverName = "vpn.example.com",
                obfsPassword = "mask",
            ),
        )
        assertTrue(json.contains("\"type\": \"hysteria2\""))
        assertTrue(json.contains("\"insecure\":false"))
        assertFalse(json.contains("\"insecure\":true"))
    }

    @Test
    fun `tuic disables zero rtt and uses allowed congestion control`() {
        val json = ProfileGenerators.tuic(
            TuicProfile(
                server = "203.0.113.20",
                port = 443,
                uuid = "2DD61D93-75D8-4DA4-AC0E-6AECE7EAC365",
                password = "secret",
                serverName = "tuic.example.com",
                congestionControl = "bbr",
            ),
        )
        assertTrue(json.contains("\"zero_rtt_handshake\": false"))
        assertTrue(json.contains("\"congestion_control\": \"bbr\""))
    }

    @Test
    fun `reality keeps private key out of client profile`() {
        val json = ProfileGenerators.reality(
            RealityProfile(
                server = "203.0.113.30",
                port = 443,
                uuid = "059032A9-7D40-4A96-9BB1-36823D848068",
                serverName = "www.example.com",
                publicKey = "PUBLIC_KEY",
                shortId = "0123456789abcdef",
            ),
        )
        assertTrue(json.contains("\"public_key\": \"PUBLIC_KEY\""))
        assertFalse(json.contains("private_key", ignoreCase = true))
        assertFalse(json.contains("\"insecure\": true"))
    }
}
