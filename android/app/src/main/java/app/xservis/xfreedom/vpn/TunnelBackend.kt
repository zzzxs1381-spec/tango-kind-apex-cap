package app.xservis.xfreedom.vpn

import android.net.VpnService

interface TunnelBackend {
    val id: String
    val ready: Boolean

    fun connect(service: VpnService): Result<Unit>
    fun disconnect()
}

object TunnelCoreRegistry {
    /**
     * Intentionally unavailable until a concrete audited native core is linked.
     * This prevents the app from establishing a TUN that would black-hole user
     * traffic while still allowing the real Android VPN permission/service flow
     * and network diagnostics to be built and tested now.
     */
    var backend: TunnelBackend = UnavailableTunnelBackend
}

private object UnavailableTunnelBackend : TunnelBackend {
    override val id: String = "not-linked"
    override val ready: Boolean = false

    override fun connect(service: VpnService): Result<Unit> =
        Result.failure(IllegalStateException("Tunnel core is not linked in this build"))

    override fun disconnect() = Unit
}
