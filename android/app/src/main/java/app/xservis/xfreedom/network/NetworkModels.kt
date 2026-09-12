package app.xservis.xfreedom.network

enum class ProbeState { PASS, FAIL, UNKNOWN }

enum class AccessType { WIFI, ETHERNET, MOBILE, UNKNOWN }

data class ControlProbe(
    val dns: ProbeState,
    val tcp443: ProbeState,
    val tls: ProbeState,
    val udp443: ProbeState,
    val quic: ProbeState,
)

data class AppProbe(
    val id: String,
    val dns: ProbeState,
    val tcp443: ProbeState,
    val tls: ProbeState,
    val http: ProbeState,
    val quic: ProbeState = ProbeState.UNKNOWN,
)

data class NetworkSnapshot(
    val observedAtEpochMs: Long,
    val accessType: AccessType,
    val control: ControlProbe,
    val apps: List<AppProbe>,
    val transportAvailable: ProbeState = ProbeState.UNKNOWN,
    val whitelistMode: WhitelistMode = WhitelistMode.NOT_OBSERVED,
)

enum class WhitelistMode { CONFIRMED, SUSPECTED, NOT_OBSERVED }

enum class InterferenceKind {
    NORMAL,
    UNKNOWN,
    TRANSPORT_SHUTDOWN,
    WHITELIST_ONLY,
    NETWORK_PATH_FAILURE,
    DNS_INTERFERENCE_SUSPECTED,
    TLS_INTERFERENCE_SUSPECTED,
    UDP_DEGRADED_OR_BLOCKED,
    APPLICATION_INTERFERENCE_SUSPECTED,
}

data class Classification(
    val kind: InterferenceKind,
    val confidence: Double,
    val evidence: List<String>,
    val limitations: List<String>,
)

enum class TransportName {
    HYSTERIA2_NATIVE,
    TUIC_V5,
    HYSTERIA2_OBFUSCATED,
    VLESS_REALITY,
    WIREGUARD,
    SSH_TLS,
    DNS_TUNNEL,
}

enum class DecisionAction { CONNECT, COLLECT_MORE_EVIDENCE, SWITCH_UPLINK }

data class TransportDecision(
    val primary: TransportName?,
    val fallbacks: List<TransportName>,
    val confidence: Double,
    val reason: String,
    val action: DecisionAction,
)
