export type ProbeState = "pass" | "fail" | "unknown";

export type AccessType = "wifi" | "ethernet" | "mobile" | "unknown";

export type AppProbeEvidence = {
  id: string;
  dns: ProbeState;
  tcp443: ProbeState;
  tls: ProbeState;
  http: ProbeState;
  quic?: ProbeState;
};

export type NetworkSnapshot = {
  observedAt: string;
  accessType: AccessType;
  operator?: string;
  asn?: string;
  region?: string;
  city?: string;
  control: {
    dns: ProbeState;
    tcp443: ProbeState;
    tls: ProbeState;
    udp443: ProbeState;
    quic: ProbeState;
  };
  apps: AppProbeEvidence[];
  indicators?: {
    transportAvailable?: ProbeState;
    whitelistMode?: "confirmed" | "suspected" | "not-observed";
  };
};

export type InterferenceKind =
  | "normal"
  | "unknown"
  | "transport_shutdown"
  | "whitelist_only"
  | "network_path_failure"
  | "dns_interference_suspected"
  | "tls_interference_suspected"
  | "udp_degraded_or_blocked"
  | "application_interference_suspected";

export type Classification = {
  kind: InterferenceKind;
  confidence: number;
  evidence: string[];
  limitations: string[];
};

export type TransportName = "hysteria2-native" | "tuic-v5" | "hysteria2-obfuscated" | "vless-reality";

export type TransportDecision = {
  primary: TransportName | null;
  fallbacks: TransportName[];
  confidence: number;
  reason: string;
  action: "connect" | "collect_more_evidence" | "switch_uplink";
};

function everyApp(snapshot: NetworkSnapshot, state: ProbeState) {
  return snapshot.apps.length > 0 && snapshot.apps.every((app) => app.http === state);
}

function someApp(snapshot: NetworkSnapshot, state: ProbeState) {
  return snapshot.apps.some((app) => app.http === state);
}

export function classifyNetwork(snapshot: NetworkSnapshot): Classification {
  const evidence: string[] = [];
  const limitations = [
    "Классификация описывает наблюдаемое сетевое поведение и сама по себе не доказывает участие конкретного регулятора или оборудования.",
  ];

  if (snapshot.indicators?.transportAvailable === "fail") {
    evidence.push("Базовый транспорт помечен как недоступный независимой системной проверкой.");
    return { kind: "transport_shutdown", confidence: 0.98, evidence, limitations };
  }

  if (snapshot.indicators?.whitelistMode === "confirmed") {
    evidence.push("Режим allowlist/белого списка подтверждён внешним системным сигналом или операторской политикой.");
    return { kind: "whitelist_only", confidence: 0.98, evidence, limitations };
  }

  if (snapshot.indicators?.whitelistMode === "suspected") {
    evidence.push("Наблюдается профиль, совместимый с allowlist-режимом, но подтверждения оператора нет.");
    return { kind: "whitelist_only", confidence: 0.62, evidence, limitations };
  }

  const c = snapshot.control;

  if (c.dns === "pass" && c.tcp443 === "fail") {
    evidence.push("Контрольный DNS проходит, но контрольный TCP/443 не устанавливается.");
    limitations.push("Это также совместимо с аварией маршрутизации, firewall или проблемой провайдера.");
    return { kind: "network_path_failure", confidence: 0.72, evidence, limitations };
  }

  if (c.dns === "fail" && c.tcp443 === "pass") {
    evidence.push("Контрольный TCP/443 доступен при неуспешном DNS-контроле.");
    limitations.push("Нужны сравнение системного DNS с независимым резолвером и несколько доменов.");
    return { kind: "dns_interference_suspected", confidence: 0.64, evidence, limitations };
  }

  if (c.tcp443 === "pass" && c.tls === "fail") {
    evidence.push("TCP/443 устанавливается, но контрольный TLS handshake не завершается.");
    limitations.push("Нужны packet-level данные или повторяемые TLS-пробы, чтобы отличить фильтрацию от сетевой ошибки.");
    return { kind: "tls_interference_suspected", confidence: 0.61, evidence, limitations };
  }

  if (c.tcp443 === "pass" && c.tls === "pass" && c.udp443 === "fail") {
    evidence.push("TCP/TLS на 443 работают, а UDP/443 не проходит.");
    limitations.push("Падение UDP может быть следствием NAT, QoS, перегрузки или фильтрации.");
    return { kind: "udp_degraded_or_blocked", confidence: 0.78, evidence, limitations };
  }

  if (c.dns === "pass" && c.tcp443 === "pass" && c.tls === "pass" && someApp(snapshot, "fail")) {
    evidence.push("Контрольный DNS/TCP/TLS работает, но как минимум один прикладной endpoint не проходит.");
    limitations.push("Нужно исключить глобальный сбой самого приложения и различия CDN/аккаунта/региона.");
    return { kind: "application_interference_suspected", confidence: 0.66, evidence, limitations };
  }

  if (
    c.dns === "pass" &&
    c.tcp443 === "pass" &&
    c.tls === "pass" &&
    c.udp443 === "pass" &&
    c.quic === "pass" &&
    everyApp(snapshot, "pass")
  ) {
    evidence.push("Контрольные DNS/TCP/TLS/UDP/QUIC и все прикладные HTTP-пробы прошли.");
    return { kind: "normal", confidence: 0.93, evidence, limitations };
  }

  evidence.push("Набора независимых сигналов недостаточно для уверенной классификации.");
  return { kind: "unknown", confidence: 0.2, evidence, limitations };
}

export function decideTransport(snapshot: NetworkSnapshot): TransportDecision {
  const classification = classifyNetwork(snapshot);

  if (classification.kind === "transport_shutdown" || classification.kind === "whitelist_only") {
    return {
      primary: null,
      fallbacks: [],
      confidence: classification.confidence,
      reason: "Перебор туннельных протоколов не исправит отсутствие общего транспорта или allowlist-only режим.",
      action: "switch_uplink",
    };
  }

  const c = snapshot.control;

  if (c.udp443 === "pass" && c.quic === "pass") {
    return {
      primary: "hysteria2-native",
      fallbacks: ["tuic-v5", "hysteria2-obfuscated", "vless-reality"],
      confidence: 0.84,
      reason: "Свежие системные пробы подтверждают UDP/443 и QUIC; TCP/TLS fallback сохранён независимо.",
      action: "connect",
    };
  }

  if (c.udp443 === "fail" && c.tcp443 === "pass" && c.tls === "pass") {
    return {
      primary: "vless-reality",
      fallbacks: [],
      confidence: 0.82,
      reason: "UDP/443 недоступен, но контрольные TCP/443 и TLS проходят.",
      action: "connect",
    };
  }

  return {
    primary: null,
    fallbacks: [],
    confidence: 0.25,
    reason: "Текущих системных измерений недостаточно, чтобы честно выбрать транспорт.",
    action: "collect_more_evidence",
  };
}
