# XFreedom Android Superstack

## Goal

Build one lawful Android app that combines the strongest usable parts of TLS Tunnel, HTTP Injector and the existing XFreedom evidence engine.

User flow:

INSTALL → grant Android VPN permission once → CONNECT → measure network → choose node → choose transport → verify tunnel → check priority apps → show result.

## Source feature inventory

HTTP Injector feature set to match or exceed:

- SSH, Proxy, SSL/TLS tunnel, DNS tunnel, Shadowsocks, V2Ray/Xray, Hysteria, WireGuard.
- Host checker, IP hunter, payload generator.
- App filter / split tunneling.
- DNS changer.
- Provider mode with encrypted/locked exported configs.

TLS Tunnel feature set to match or exceed:

- one-tap VPN UX;
- TLS 1.3 based encrypted connections;
- private server mode with SSH support;
- IPv6 readiness;
- UDP/DTLS mode;
- DoH host analysis;
- Wakelock/Wifilock/Pinger behavior;
- recovery when Wi-Fi and mobile data are both active;
- battery-conscious Android background service.

Do not reverse engineer, decompile or copy proprietary code/assets. Implement with our own UX, open protocols and licensed cores.

## Product stack

### Android app

- Kotlin.
- Jetpack Compose UI.
- Android VpnService for TUN permission and packet routing.
- ForegroundService with persistent notification.
- Room or SQLDelight for local state later.
- DataStore for settings later.
- WorkManager for scheduled probes and config refresh later.

### Network core

Use an adapter boundary instead of hard-wiring the entire app to one native core:

1. Xray adapter for REALITY/Vision/XHTTP and compatible proxy protocols.
2. Hysteria2 adapter for QUIC/HY2.
3. WireGuard Android tunnel adapter.
4. TUIC v5 adapter where the selected runtime supports it.
5. SSH/TLS/HTTP payload compatibility module.
6. DNSTT/SlowDNS emergency module.

A sing-box/libbox adapter remains technically attractive, but must not be silently embedded until the application license is explicitly chosen because the Android libbox package is GPL-3.0.

### Transports

Decision order is conditional on fresh evidence, not globally hardcoded.

When UDP/443 + QUIC are confirmed:

1. Hysteria2 Native.
2. TUIC v5.
3. Hysteria2 Obfuscated.
4. VLESS Reality / TCP fallback.

When UDP is measured unavailable but TCP/443 + TLS are healthy:

1. VLESS Reality.
2. SSH/TLS compatibility fallback.

DNS tunnel / SlowDNS is emergency-only for low-bandwidth restricted networks.

### XFreedom intelligence layer

Use the existing NetworkSnapshot contract:

- DNS state: pass/fail/unknown.
- TCP/443 state.
- TLS handshake state.
- UDP/443 state.
- QUIC/HTTP3 state.
- app probes: WhatsApp, Telegram, YouTube, Instagram, TikTok.
- access type: mobile/wifi/ethernet/unknown.
- optional operator/ASN/region/city labels.

Never classify one timeout as proof of DPI. Use suspected/unknown unless independent evidence is sufficient.

### Server stack

- Foreign core nodes: REALITY, HY2, TUIC, WireGuard/AmneziaWG where configured.
- RU edge node: diagnostics/status relay/failover where appropriate.
- Control Center: health, config generation, key rotation, revocation, snapshots and regional success rates.
- PostgreSQL for accounts/orders/config metadata.
- Qdrant for network snapshot memory and retrieval.

## Android modules

```text
android/
  app/
    MainActivity.kt
    network/
      NetworkModels.kt
      SystemProbeEngine.kt
      DecisionEngine.kt
    vpn/
      XFreedomVpnService.kt
      TunnelBackend.kt
    config/
      ProfileGenerators.kt
```

## Security rules

- No hardcoded production secrets.
- Android Keystore for local secrets in the production profile store.
- TLS server-name verification enabled.
- `insecure=true` is not emitted by normal profile generators.
- REALITY private key never leaves the server.
- TUIC 0-RTT is disabled by default.
- Signed remote config bundles before production rollout.
- Logs must redact UUIDs, passwords, private keys, access tokens and proxy credentials.
- No packet payload capture by default.

## Implementation status — active

A real standalone Android project now exists under `android/`.

Implemented now:

- AGP 9.4.0 / compileSdk 37 / targetSdk 36 / JDK 17 project;
- Jetpack Compose main UI;
- Android `VpnService` permission flow;
- foreground-service lifecycle using `specialUse` for the user-initiated VPN process;
- Wi-Fi / cellular / Ethernet access-type detection;
- native DNS, TCP/443, TLS and HTTPS probes;
- priority probes for WhatsApp, TikTok, YouTube, Instagram and Telegram;
- Android NetworkSnapshot model;
- evidence-based classifier and transport decision engine;
- Hysteria2, TUIC v5 and VLESS Reality profile generators;
- unit tests for decision and profile safety rules;
- dedicated Android CI which builds a debug APK artifact.

Deliberately not faked:

- no empty TUN is established before a native packet-forwarding core is linked;
- generic UDP/443 / QUIC remain `UNKNOWN` until a real QUIC-capable probe/core is integrated;
- no claim of working packet forwarding is made yet;
- no regional Russia/Crimea success claim without on-device evidence.

## Next slices

1. make Android CI green and retrieve the produced debug APK;
2. choose/add the repository application license;
3. link the first audited native tunnel backend;
4. add QUIC/UDP probes;
5. add encrypted local profile storage and import/export;
6. add per-app split tunneling;
7. add post-connect app verification and automatic failover;
8. connect snapshots to the XFreedom backend/Qdrant history layer;
9. validate on real Russian networks by operator/region/access type.

## Definition of done

- User installs APK and grants VPN permission once.
- App measures the current network before transport selection.
- A production native core forwards real packets through the selected tunnel.
- Transport failover works without UI freezing.
- Priority app checks run after connection.
- Admin can revoke configs.
- CI builds web, server and Android APK.
- No censorship mechanism or regional success is claimed without evidence.
