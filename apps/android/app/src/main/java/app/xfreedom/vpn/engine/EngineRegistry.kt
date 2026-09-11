package app.xfreedom.vpn.engine

import android.content.Context

/**
 * Central registry used by the decision engine. Empty by design until a native
 * adapter is packaged and verified. Never report CONNECTED while this list has
 * no ready implementation.
 */
object EngineRegistry {
    private val engines = mutableListOf<TunnelEngine>()

    @Synchronized
    fun register(engine: TunnelEngine) {
        engines.removeAll { it.id == engine.id }
        engines += engine
    }

    @Synchronized
    fun all(): List<TunnelEngine> = engines.toList()

    @Synchronized
    fun firstReady(context: Context): TunnelEngine? = engines.firstOrNull { it.isReady(context) }
}
