package app.xservis.xfreedom.vpn

import android.content.Context
import android.content.Intent
import android.net.VpnService
import com.wireguard.android.backend.GoBackend
import com.wireguard.android.backend.Tunnel
import com.wireguard.config.Config
import java.io.ByteArrayInputStream
import java.util.concurrent.atomic.AtomicReference

/**
 * Service-native WireGuard backend.
 *
 * The official WireGuard GoBackend owns its own Android VpnService, so this
 * adapter must not be executed inside XFreedomVpnService. Android's one global
 * VPN permission still applies and is requested by MainActivity.
 */
class WireGuardBackend(context: Context) {
    private val appContext = context.applicationContext
    private val backend = GoBackend(appContext)
    private val tunnel = XFreedomWireGuardTunnel("xf-wg")

    fun prepareIntent(): Intent? = VpnService.prepare(appContext)

    fun connect(wgQuickConfig: String): Result<Unit> = runCatching {
        require(wgQuickConfig.toByteArray(Charsets.UTF_8).size <= MAX_CONFIG_BYTES) {
            "WireGuard config is too large"
        }
        val config = ByteArrayInputStream(wgQuickConfig.toByteArray(Charsets.UTF_8)).use(Config::parse)
        backend.setState(tunnel, Tunnel.State.UP, config)
        check(backend.getState(tunnel) == Tunnel.State.UP) { "WireGuard backend did not enter UP state" }
    }

    fun disconnect(): Result<Unit> = runCatching {
        backend.setState(tunnel, Tunnel.State.DOWN, null)
    }

    fun state(): Tunnel.State = backend.getState(tunnel)

    private class XFreedomWireGuardTunnel(private val tunnelName: String) : Tunnel {
        private val current = AtomicReference(Tunnel.State.DOWN)

        override fun getName(): String = tunnelName

        override fun onStateChange(newState: Tunnel.State) {
            current.set(newState)
        }
    }

    private companion object {
        const val MAX_CONFIG_BYTES = 64 * 1024
    }
}
