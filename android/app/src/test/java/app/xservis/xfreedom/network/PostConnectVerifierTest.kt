package app.xservis.xfreedom.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PostConnectVerifierTest {
    private fun snapshot(
        controlTls: ProbeState = ProbeState.PASS,
        whatsapp: ProbeState = ProbeState.FAIL,
        youtube: ProbeState = ProbeState.PASS,
    ) = NetworkSnapshot(
        observedAtEpochMs = 1L,
        accessType = AccessType.MOBILE,
        control = ControlProbe(
            dns = ProbeState.PASS,
            tcp443 = ProbeState.PASS,
            tls = controlTls,
            udp443 = ProbeState.UNKNOWN,
            quic = ProbeState.UNKNOWN,
        ),
        apps = listOf(
            AppProbe("whatsapp", ProbeState.PASS, ProbeState.PASS, ProbeState.PASS, whatsapp),
            AppProbe("youtube", ProbeState.PASS, ProbeState.PASS, ProbeState.PASS, youtube),
        ),
    )

    @Test
    fun `keeps tunnel when a blocked app improves without degrading healthy apps`() {
        val result = PostConnectVerifier.compare(
            before = snapshot(),
            after = snapshot(whatsapp = ProbeState.PASS),
        )
        assertEquals(VerificationAction.KEEP_TUNNEL, result.action)
        assertTrue("whatsapp" in result.improvedApps)
    }

    @Test
    fun `falls back when tunnel breaks control tls`() {
        val result = PostConnectVerifier.compare(
            before = snapshot(),
            after = snapshot(controlTls = ProbeState.FAIL),
        )
        assertEquals(VerificationAction.TRY_FALLBACK, result.action)
    }

    @Test
    fun `falls back when tunnel degrades an app that was healthy before`() {
        val result = PostConnectVerifier.compare(
            before = snapshot(whatsapp = ProbeState.PASS),
            after = snapshot(whatsapp = ProbeState.PASS, youtube = ProbeState.FAIL),
        )
        assertEquals(VerificationAction.TRY_FALLBACK, result.action)
        assertTrue("youtube" in result.degradedApps)
    }
}
