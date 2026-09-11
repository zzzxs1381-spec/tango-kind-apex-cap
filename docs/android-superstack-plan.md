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
- server list, random server selection, access renewal/status;
- battery-conscious Android background service.

Do not reverse engineer, decompile or copy proprietary code/assets. Implement with our own UX, open protocols and licensed cores.

## Product stack

### Android app

- Kotlin.
- Jetpack Compose UI.
- Android VpnService for TUN permission and packet routing.
- ForegroundService with persistent notification.
- Room or SQLDelight for local state.
- DataStore for settings.
- WorkManager for scheduled probes and config refresh.
- Rust/Kotlin shared engine via JNI only when native performance is needed.

### Network core

Primary core strategy:

1. sing-box compatible core for TUN, routing, DNS, split tunneling, shadowsocks, vless/vmess, wireguard family where supported.
2. Xray-core embedded/managed for REALITY/Vision/XHTTP where sing-box support is incomplete.
3. Hysteria2 official core/client integration for QUIC/HY2.
4. TUIC v5 adapter where supported by the selected core.
5. SSH/TLS/HTTP payload module as compatibility fallback, not as the first option.

### Transports

Decision order for normal networks:

1. Hysteria2 Native, UDP/443, valid TLS, no obfs by default.
2. TUIC v5, UDP/443.
3. Hysteria2 Obfuscated, salamander, only when native HY2 fails and server supports it.
4. VLESS Reality, TCP/443.
5. VLESS XHTTP / WebSocket TLS fallback.
6. SSH over TLS/SNI/payload compatibility mode.
7. DNS tunnel / SlowDNS emergency mode only for very restricted networks and low-bandwidth tasks.

### XFreedom intelligence layer

Use the existing PR #9 NetworkSnapshot contract:

- DNS state: pass/fail/unknown.
- TCP/443 state.
- TLS handshake state.
- UDP/443 state.
- QUIC/HTTP3 state.
- app probes: WhatsApp, Telegram, YouTube, Instagram, TikTok.
- access type: mobile/wifi/ethernet/unknown.
- optional operator/ASN/region/city labels.

Never classify browser-only failure as DPI proof. Use suspected/unknown unless native evidence is enough.

### Server stack

- Foreign core nodes: REALITY, HY2, TUIC, WireGuard/AmneziaWG where lawful and configured.
- RU edge node: diagnostics, status relay and failover edge when legally appropriate.
- Control Center: node health, config generation, key rotation, revocation, snapshots, regional success rates.
- PostgreSQL for accounts/orders/config metadata.
- Qdrant for network snapshot memory and retrieval.
- Prometheus-compatible health metrics later.

## Android modules

```text
android/
  app/
    ui/                 Compose screens
    vpn/                VpnService, TUN lifecycle, foreground service
    probes/             DNS/TCP/TLS/QUIC/app checks
    engine/             DecisionEngine client and local fallback rules
    core/               sing-box/Xray/HY2 process management
    config/             URI + JSON profile generators
    data/               Room/DataStore models
    security/           keystore, cert pinning, encrypted configs
    telemetry/          consented diagnostics only
```

## Screens

1. Onboarding: privacy, VPN permission, no packet payload capture.
2. Main: one large CONNECT button, current network, chosen route.
3. Diagnostics: evidence list with statuses and confidence.
4. Apps: WhatsApp, Telegram, YouTube, Instagram, TikTok post-connect checks.
5. Servers: auto/best/manual.
6. Advanced: import/export profiles, DNS, split tunneling, provider mode.
7. Control Center login for admins.

## Provider mode

- Export locked configs.
- Sign config bundles.
- Encrypt secrets at rest.
- Revoke by config id/user id/device id.
- Never expose REALITY private key to clients.

## Security rules

- No hardcoded production secrets.
- Android Keystore for local keys.
- TLS certificate pinning for control API.
- Signed remote config bundles.
- Kill switch support.
- Split tunneling must be explicit.
- Logs must redact UUIDs, passwords, private keys, access tokens and proxy credentials.

## MVP build phases

### Phase 1 — Android shell

- Kotlin/Compose project.
- VpnService permission.
- Foreground service.
- Main screen and Diagnostics screen.
- Local NetworkSnapshot model.

### Phase 2 — probes

- DNS resolver test.
- TCP/443 socket test.
- TLS handshake test with SNI.
- QUIC/HTTP3 check through bundled/native library or core.
- App endpoint checks without login and without payload capture.

### Phase 3 — config and core

- Generate HY2, TUIC, REALITY and sing-box configs.
- Start selected core.
- Attach TUN through VpnService.
- Verify tunnel.

### Phase 4 — backend

- Endpoint for signed node list.
- Endpoint for anonymous NetworkSnapshot upload.
- Control Center integration.
- Qdrant memory write.

### Phase 5 — release hardening

- Battery tests.
- Android 8–15 compatibility.
- Play Console privacy labels.
- Crash reporting without secrets.
- Reproducible build notes.

## Definition of done

- User can install APK, grant VPN permission once and connect.
- App auto-selects transport from fresh native measurements.
- Transport failover works without UI freezing.
- Priority app checks run after connection.
- Admin can revoke configs.
- CI builds web, server and Android debug APK.
- No claim of Russia/Crimea success without real regional probe evidence.
