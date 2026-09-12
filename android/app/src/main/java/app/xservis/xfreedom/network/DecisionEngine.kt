package app.xservis.xfreedom.network

object DecisionEngine {
    fun classify(snapshot: NetworkSnapshot): Classification {
        val limitations = mutableListOf(
            "Наблюдаемое поведение само по себе не доказывает участие конкретного регулятора, DPI или ТСПУ.",
        )
        val evidence = mutableListOf<String>()

        if (snapshot.transportAvailable == ProbeState.FAIL) {
            evidence += "Системная проверка общего транспорта завершилась неуспешно."
            return Classification(
                InterferenceKind.TRANSPORT_SHUTDOWN,
                0.98,
                evidence,
                limitations,
            )
        }

        if (snapshot.whitelistMode == WhitelistMode.CONFIRMED) {
            evidence += "Allowlist-режим подтверждён независимым системным или операторским сигналом."
            return Classification(
                InterferenceKind.WHITELIST_ONLY,
                0.98,
                evidence,
                limitations,
            )
        }

        if (snapshot.whitelistMode == WhitelistMode.SUSPECTED) {
            evidence += "Профиль сети совместим с allowlist-режимом, но подтверждения оператора нет."
            return Classification(
                InterferenceKind.WHITELIST_ONLY,
                0.62,
                evidence,
                limitations,
            )
        }

        val c = snapshot.control

        if (c.dns == ProbeState.PASS && c.tcp443 == ProbeState.FAIL) {
            evidence += "Контрольный DNS работает, но TCP/443 не устанавливается."
            limitations += "Это также совместимо с аварией маршрутизации, firewall или проблемой провайдера."
            return Classification(InterferenceKind.NETWORK_PATH_FAILURE, 0.72, evidence, limitations)
        }

        if (c.dns == ProbeState.FAIL && c.tcp443 == ProbeState.PASS) {
            evidence += "TCP/443 доступен при неуспешном DNS-контроле."
            limitations += "Нужны несколько DNS-контролей и независимый resolver прежде чем говорить о DNS-фильтрации."
            return Classification(InterferenceKind.DNS_INTERFERENCE_SUSPECTED, 0.64, evidence, limitations)
        }

        if (c.tcp443 == ProbeState.PASS && c.tls == ProbeState.FAIL) {
            evidence += "TCP/443 устанавливается, но TLS handshake не завершается."
            limitations += "Нужны повторяемые TLS-пробы или packet-level evidence, чтобы отличить фильтрацию от сетевой ошибки."
            return Classification(InterferenceKind.TLS_INTERFERENCE_SUSPECTED, 0.61, evidence, limitations)
        }

        if (c.tcp443 == ProbeState.PASS && c.tls == ProbeState.PASS && c.udp443 == ProbeState.FAIL) {
            evidence += "TCP/TLS на 443 работают, а UDP/443 не проходит."
            limitations += "UDP может ломаться из-за NAT, QoS, перегрузки или фильтрации."
            return Classification(InterferenceKind.UDP_DEGRADED_OR_BLOCKED, 0.78, evidence, limitations)
        }

        if (
            c.dns == ProbeState.PASS &&
            c.tcp443 == ProbeState.PASS &&
            c.tls == ProbeState.PASS &&
            snapshot.apps.any { it.http == ProbeState.FAIL }
        ) {
            evidence += "Контрольные DNS/TCP/TLS работают, но один или несколько app endpoint не проходят."
            limitations += "Нужно исключить глобальный сбой приложения, CDN, региональную политику и account-specific поведение."
            return Classification(
                InterferenceKind.APPLICATION_INTERFERENCE_SUSPECTED,
                0.66,
                evidence,
                limitations,
            )
        }

        if (
            c.dns == ProbeState.PASS &&
            c.tcp443 == ProbeState.PASS &&
            c.tls == ProbeState.PASS &&
            c.udp443 == ProbeState.PASS &&
            c.quic == ProbeState.PASS &&
            snapshot.apps.isNotEmpty() &&
            snapshot.apps.all { it.http == ProbeState.PASS }
        ) {
            evidence += "Контрольные DNS/TCP/TLS/UDP/QUIC и все app HTTP-пробы прошли."
            return Classification(InterferenceKind.NORMAL, 0.93, evidence, limitations)
        }

        evidence += "Данных пока недостаточно для уверенной классификации."
        return Classification(InterferenceKind.UNKNOWN, 0.20, evidence, limitations)
    }

    /**
     * Ideal transport order from fresh network evidence, independent of which
     * native engines or profiles happen to be present on the client.
     */
    fun decide(snapshot: NetworkSnapshot): TransportDecision {
        val classification = classify(snapshot)

        if (
            classification.kind == InterferenceKind.TRANSPORT_SHUTDOWN ||
            classification.kind == InterferenceKind.WHITELIST_ONLY
        ) {
            return TransportDecision(
                primary = null,
                fallbacks = emptyList(),
                confidence = classification.confidence,
                reason = "Перебор VPN-протоколов не исправит отсутствие общего транспорта или allowlist-only режим.",
                action = DecisionAction.SWITCH_UPLINK,
            )
        }

        val c = snapshot.control
        if (c.udp443 == ProbeState.PASS && c.quic == ProbeState.PASS) {
            return TransportDecision(
                primary = TransportName.HYSTERIA2_NATIVE,
                fallbacks = listOf(
                    TransportName.TUIC_V5,
                    TransportName.HYSTERIA2_OBFUSCATED,
                    TransportName.VLESS_REALITY,
                    TransportName.WIREGUARD,
                    TransportName.SSH_TLS,
                ),
                confidence = 0.84,
                reason = "Свежие системные пробы подтверждают UDP/443 и QUIC; независимый TCP/TLS fallback сохранён.",
                action = DecisionAction.CONNECT,
            )
        }

        if (c.udp443 == ProbeState.FAIL && c.tcp443 == ProbeState.PASS && c.tls == ProbeState.PASS) {
            return TransportDecision(
                primary = TransportName.VLESS_REALITY,
                fallbacks = listOf(TransportName.SSH_TLS),
                confidence = 0.82,
                reason = "UDP/443 недоступен, а TCP/443 и TLS проходят.",
                action = DecisionAction.CONNECT,
            )
        }

        return TransportDecision(
            primary = null,
            fallbacks = emptyList(),
            confidence = 0.25,
            reason = "Недостаточно системных измерений для честного выбора транспорта.",
            action = DecisionAction.COLLECT_MORE_EVIDENCE,
        )
    }

    /**
     * Client-facing decision. It never selects a transport that the APK cannot
     * actually start or for which the user/server has not provided a profile.
     */
    fun decide(
        snapshot: NetworkSnapshot,
        availableTransports: Set<TransportName>,
    ): TransportDecision {
        val ideal = decide(snapshot)

        if (ideal.action == DecisionAction.SWITCH_UPLINK) return ideal

        if (ideal.action == DecisionAction.CONNECT && ideal.primary != null) {
            val ordered = listOf(ideal.primary) + ideal.fallbacks
            val selectedIndex = ordered.indexOfFirst { it in availableTransports }
            if (selectedIndex >= 0) {
                val selected = ordered[selectedIndex]
                val availableFallbacks = ordered
                    .drop(selectedIndex + 1)
                    .filter { it in availableTransports }
                    .distinct()
                return ideal.copy(
                    primary = selected,
                    fallbacks = availableFallbacks,
                    confidence = if (selectedIndex == 0) ideal.confidence else (ideal.confidence - 0.12).coerceAtLeast(0.45),
                    reason = ideal.reason + " Клиент выбрал реально доступный backend: ${selected.name}.",
                )
            }

            return TransportDecision(
                primary = null,
                fallbacks = emptyList(),
                confidence = 0.40,
                reason = "Сеть допускает туннель, но ни один рекомендованный backend не установлен или не настроен в клиенте.",
                action = DecisionAction.COLLECT_MORE_EVIDENCE,
            )
        }

        val c = snapshot.control
        if (
            c.tcp443 == ProbeState.PASS &&
            c.tls == ProbeState.PASS &&
            c.udp443 == ProbeState.UNKNOWN &&
            c.quic == ProbeState.UNKNOWN &&
            TransportName.VLESS_REALITY in availableTransports
        ) {
            val fallbacks = buildList {
                if (TransportName.WIREGUARD in availableTransports) add(TransportName.WIREGUARD)
            }
            return TransportDecision(
                primary = TransportName.VLESS_REALITY,
                fallbacks = fallbacks,
                confidence = 0.68,
                reason = "UDP/QUIC ещё не измерены, но TCP/443 и TLS подтверждены; используем доступный REALITY как консервативный TCP fallback с обязательной post-connect проверкой.",
                action = DecisionAction.CONNECT,
            )
        }

        return ideal.copy(
            reason = ideal.reason + " Доступные backend: ${availableTransports.ifEmpty { setOf() }.joinToString().ifBlank { "нет" }}.",
        )
    }
}
