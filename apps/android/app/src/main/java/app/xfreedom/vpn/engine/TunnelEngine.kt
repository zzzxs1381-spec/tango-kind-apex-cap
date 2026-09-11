package app.xfreedom.vpn.engine

import android.content.Context

/**
 * Transport-neutral contract for native VPN engines.
 *
 * Concrete adapters (Xray/libXray, Hysteria2, TUIC, AmneziaWG/WireGuard)
 * must own their native lifecycle and return failures instead of silently
 * falling back to an insecure path.
 */
interface TunnelEngine {
    val id: String
    val displayName: String

    /** True only when all native/runtime assets needed for a real tunnel exist. */
    fun isReady(context: Context): Boolean

    /** Validate a serialized engine configuration without starting a tunnel. */
    fun validate(context: Context, config: String): Result<Unit>

    /** Start the engine against an already-created Android TUN file descriptor. */
    fun start(context: Context, tunFd: Int, config: String): Result<Unit>

    /** Stop the engine and release native resources. */
    fun stop(context: Context): Result<Unit>
}
