# Implementation prompt — XFreedom Android Superstack

You are continuing the existing XFreedom / XSERVIS repository. Do not rebuild the web app from zero. Build a real Android VPN client as a new Android project/module while preserving existing web/server code and PR #9 network-intelligence contract.

## Mission

Create a lawful, production-grade Android VPN app inspired by the feature classes of TLS Tunnel and HTTP Injector, but with original code, original UI and XFreedom evidence-based transport selection.

User experience:

INSTALL APK → allow Android VPN permission once → tap CONNECT → app probes network → picks best server and transport → starts VPN → verifies tunnel → checks priority apps → displays exact evidence.

## Hard requirements

1. Kotlin + Jetpack Compose Android app.
2. Use Android VpnService for TUN; no root requirement.
3. ForegroundService notification while VPN is active.
4. Local `NetworkSnapshot` model matching `src/lib/network-intelligence.ts` semantics.
5. Native/system probes, not browser-only guesses:
   - DNS;
   - TCP/443;
   - TLS handshake with SNI;
   - UDP/443;
   - QUIC/HTTP3 when supported;
   - priority app endpoint checks: WhatsApp, Telegram, YouTube, Instagram, TikTok.
6. Decision order:
   - Hysteria2 Native / UDP 443;
   - TUIC v5 / UDP 443;
   - Hysteria2 Obfuscated / salamander;
   - VLESS Reality / TCP 443;
   - VLESS XHTTP or WebSocket TLS fallback;
   - SSH/TLS/HTTP payload compatibility fallback;
   - DNS tunnel emergency mode only for low-bandwidth restricted networks.
7. No unsafe TLS mode by default. No `insecure=1` production profiles.
8. REALITY private key never goes to client.
9. Config bundles must be signed and revocable.
10. Logs redact secrets.
11. Do not claim RKN/TSPU/DPI as confirmed from weak evidence. Use `suspected` or `unknown` unless multiple independent measurements justify stronger status.
12. App must work offline enough to show previous profiles and diagnostics history.
13. Add Android CI for debug APK build.

## Architecture to implement

```text
android/
  settings.gradle.kts
  build.gradle.kts
  app/
    build.gradle.kts
    src/main/AndroidManifest.xml
    src/main/java/app/xfreedom/
      MainActivity.kt
      vpn/XFreedomVpnService.kt
      vpn/VpnController.kt
      probes/NetworkProbe.kt
      engine/DecisionEngine.kt
      engine/Models.kt
      config/ProfileGenerator.kt
      core/CoreProcessManager.kt
      ui/App.kt
      ui/screens/MainScreen.kt
      ui/screens/DiagnosticsScreen.kt
      ui/screens/SettingsScreen.kt
      data/LocalStore.kt
      security/ConfigVerifier.kt
```

## First PR deliverable

- Buildable Android project skeleton.
- Main Compose UI with CONNECT button.
- VpnService permission request.
- Foreground service placeholder.
- NetworkSnapshot data classes.
- DecisionEngine unit tests.
- ProfileGenerator tests for HY2, TUIC, REALITY and sing-box JSON shapes.
- No bundled proprietary binaries yet; core process manager can be interface/stub.

## Second PR deliverable

- Integrate one real core path first, preferably sing-box-compatible TUN.
- Generate and run local test profile.
- Add tunnel verification.
- Add kill switch/split-tunnel settings.

## Third PR deliverable

- Add Hysteria2 and REALITY integration.
- Add remote signed node list.
- Add post-connect app verification.
- Add failure telemetry with consent.

## Acceptance tests

- Gradle debug APK builds in CI.
- Unit tests pass.
- Starting VPN asks for Android permission and does not crash if denied.
- Decision engine refuses to choose UDP transport when UDP state is unknown/fail.
- Decision engine chooses Reality when UDP fails but TCP/TLS pass.
- Logs contain no UUID/password/private key/token.
- UI never says “connected” until TUN/core verification succeeds.

## UX copy in Russian

Use short Russian labels:

- Проверить сеть
- Подключиться
- Подключено
- Диагностика
- Маршрут
- Доказательства
- Причина не доказана
- Нужна смена сети
- Скопировать диагностику

## Legal and privacy boundaries

No decompilation or copying of TLS Tunnel / HTTP Injector internals. Use only public feature observation and open-source/properly licensed cores. Do not collect packet payloads, credentials, browsing history or exact user identity unless the user explicitly opts in for account features.
