package app.xservis.xfreedom.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DecisionEngineTest {
    private fun snapshot(
        control: ControlProbe = ControlProbe(
            dns = ProbeState.PASS,
            tcp443 = ProbeState.PASS,
            tls = ProbeState.PASS,
            udp443 = ProbeState.PASS,
            quic = ProbeState.PASS,
        ),
        transportAvailable: ProbeState = ProbeState.UNKNOWN,
        whitelistMode: WhitelistMode = WhitelistMode.NOT_OBSERVED,
    ) = NetworkSnapshot(
        observedAtEpochMs = 1L,
        accessType = AccessType.MOBILE,
        control = control,
        transportAvailable = transportAvailable,
        whitelistMode = whitelistMode,
        apps = listOf(
            AppProbe("whatsapp", ProbeState.PASS, ProbeState.PASS, ProbeState.PASS, ProbeState.PASS),
            AppProbe("youtube", ProbeState.PASS, ProbeState.PASS, ProbeState.PASS, ProbeState.PASS),
        ),
    )

    @Test
    fun `confirmed transport shutdown never guesses a tunnel`() {
        val decision = DecisionEngine.decide(snapshot(transportAvailable = ProbeState.FAIL))
        assertNull(decision.primary)
        assertEquals(DecisionAction.SWITCH_UPLINK, decision.action)
    }

    @Test
    fun `healthy quic path prefers hysteria2 with independent fallbacks`() {
        val decision = DecisionEngine.decide(snapshot())
        assertEquals(TransportName.HYSTERIA2_NATIVE, decision.primary)
        assertTrue(TransportName.VLESS_REALITY in decision.fallbacks)
        assertEquals(DecisionAction.CONNECT, decision.action)
    }

    @Test
    fun `failed udp with healthy tcp tls moves to reality`() {
        val decision = DecisionEngine.decide(
            snapshot(
                control = ControlProbe(
                    dns = ProbeState.PASS,
                    tcp443 = ProbeState.PASS,
                    tls = ProbeState.PASS,
                    udp443 = ProbeState.FAIL,
                    quic = ProbeState.FAIL,
                ),
            ),
        )
        assertEquals(TransportName.VLESS_REALITY, decision.primary)
        assertEquals(DecisionAction.CONNECT, decision.action)
    }

    @Test
    fun `unknown udp and quic asks for more evidence`() {
        val decision = DecisionEngine.decide(
            snapshot(
                control = ControlProbe(
                    dns = ProbeState.PASS,
                    tcp443 = ProbeState.PASS,
                    tls = ProbeState.PASS,
                    udp443 = ProbeState.UNKNOWN,
                    quic = ProbeState.UNKNOWN,
                ),
            ),
        )
        assertNull(decision.primary)
        assertEquals(DecisionAction.COLLECT_MORE_EVIDENCE, decision.action)
    }
}
