package app.xservis.xfreedom.network

data class PostConnectVerification(
    val tunnelControlHealthy: Boolean,
    val appPassCountBefore: Int,
    val appPassCountAfter: Int,
    val improvedApps: List<String>,
    val degradedApps: List<String>,
    val unresolvedApps: List<String>,
    val action: VerificationAction,
    val reason: String,
)

enum class VerificationAction {
    KEEP_TUNNEL,
    TRY_FALLBACK,
    COLLECT_MORE_EVIDENCE,
}

object PostConnectVerifier {
    fun compare(before: NetworkSnapshot, after: NetworkSnapshot): PostConnectVerification {
        val beforeById = before.apps.associateBy { it.id }
        val afterById = after.apps.associateBy { it.id }
        val ids = (beforeById.keys + afterById.keys).sorted()

        val improved = ids.filter { id ->
            beforeById[id]?.http != ProbeState.PASS && afterById[id]?.http == ProbeState.PASS
        }
        val degraded = ids.filter { id ->
            beforeById[id]?.http == ProbeState.PASS && afterById[id]?.http == ProbeState.FAIL
        }
        val unresolved = ids.filter { id -> afterById[id]?.http != ProbeState.PASS }

        val beforePass = before.apps.count { it.http == ProbeState.PASS }
        val afterPass = after.apps.count { it.http == ProbeState.PASS }
        val controlHealthy =
            after.control.dns == ProbeState.PASS &&
                after.control.tcp443 == ProbeState.PASS &&
                after.control.tls == ProbeState.PASS

        val action: VerificationAction
        val reason: String

        when {
            !controlHealthy -> {
                action = VerificationAction.TRY_FALLBACK
                reason = "После подключения не проходят контрольные DNS/TCP/TLS-пробы."
            }
            degraded.isNotEmpty() -> {
                action = VerificationAction.TRY_FALLBACK
                reason = "Туннель ухудшил доступность ранее работавших приложений: ${degraded.joinToString()}."
            }
            improved.isNotEmpty() && afterPass >= beforePass -> {
                action = VerificationAction.KEEP_TUNNEL
                reason = "Контрольный канал здоров, а доступность приложений улучшилась или не ухудшилась."
            }
            afterPass == beforePass && unresolved.isEmpty() -> {
                action = VerificationAction.KEEP_TUNNEL
                reason = "Контрольный канал здоров и все проверяемые приложения доступны."
            }
            else -> {
                action = VerificationAction.COLLECT_MORE_EVIDENCE
                reason = "Контрольный канал работает, но результат приложений неоднозначен; глобальный сбой или CDN-проблему нельзя исключить."
            }
        }

        return PostConnectVerification(
            tunnelControlHealthy = controlHealthy,
            appPassCountBefore = beforePass,
            appPassCountAfter = afterPass,
            improvedApps = improved,
            degradedApps = degraded,
            unresolvedApps = unresolved,
            action = action,
            reason = reason,
        )
    }
}
