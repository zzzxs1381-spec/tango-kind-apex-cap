package app.xservis.xfreedom.tls

import org.junit.Assert.*
import org.junit.Test

class TunnelEvidenceTest {
    @Test fun connectedRequiresEveryIndependentProof() {
        for(mask in 0..15) {
            val e=TunnelEvidence(mask and 1 != 0,mask and 2 != 0,mask and 4 != 0,mask and 8 != 0)
            assertEquals("proof mask $mask",mask==15,e.connected)
        }
    }
    @Test fun freshEvidenceStartsUnverified() {assertFalse(TunnelEvidence().connected)}
}
