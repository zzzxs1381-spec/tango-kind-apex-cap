# XFreedom Android

Native Android client for the XFreedom resilient-connectivity platform.

## Current milestone

Milestone 0 establishes a compileable Android application shell and the operating-system VPN lifecycle:

- package: `app.xfreedom.vpn`
- minSdk 26, targetSdk/compileSdk 36
- Android `VpnService` permission flow
- foreground service with explicit `specialUse` declaration
- no cleartext application traffic
- engine-neutral `TunnelEngine` contract
- honest connection state: the app never creates a TUN interface until a verified packet-forwarding engine is ready

This milestone is **not yet a production VPN tunnel**. It deliberately refuses to claim `CONNECTED` until a native engine is integrated and runtime verification succeeds.

## Target architecture

```text
Android apps
    ↓
Android VpnService / TUN
    ↓
XFreedom Decision Engine
    ├── Xray / libXray: VLESS + REALITY + XHTTP/Vision
    ├── Hysteria2: QUIC/UDP transport
    ├── TUIC v5: independent protocol implementation
    ├── WireGuard / AmneziaWG
    └── SSH/TLS/SNI emergency compatibility mode
    ↓
XFreedom node
    ↓
Internet
```

## Non-negotiable behavior

1. Never display `CONNECTED` before post-connect verification passes.
2. Never silently downgrade TLS validation or enable insecure certificate verification.
3. Never ship server private keys or infrastructure secrets in the APK.
4. Transport fallback is explicit, measured and logged locally with privacy-preserving telemetry.
5. Core selection must use fresh network measurements rather than stale historical success alone.
6. VPN traffic processing must remain functional if the Control Center is temporarily unavailable after a valid profile has been provisioned.

## Planned milestones

### M1 — Build and test baseline
- CI build of debug APK
- lint/unit checks
- stable service lifecycle tests

### M2 — Xray transport
- build official XTLS/libXray from source using gomobile
- VLESS REALITY
- XHTTP/Vision where supported by the pinned upstream
- config validation before tunnel start
- TUN fd handoff through the supported libXray API

### M3 — QUIC transports
- Hysteria2 native adapter
- TUIC v5 independent implementation/adapter
- UDP capability and QUIC handshake probes

### M4 — WireGuard family
- WireGuard adapter
- AmneziaWG adapter after license and API audit

### M5 — Decision engine
- DNS/IPv4/IPv6/UDP/TCP/TLS/QUIC probes
- latency EMA, loss and failure rolling windows
- hysteresis and cooldowns
- automatic transport failover

### M6 — Product UX
- Jetpack Compose production UI
- one-tap Auto mode
- expert mode
- profiles/subscriptions/QR import
- per-app split tunneling
- kill switch / Always-On guidance
- diagnostics and exportable support bundle without secrets

### M7 — Control Center integration
- signed client profiles
- node capability discovery
- revocation and profile rotation
- privacy-preserving telemetry
- no server private key exposure

### M8 — release
- signed AAB/APK
- Play VpnService declaration and privacy disclosures
- reproducible release build and SBOM
- staged rollout and crash/ANR monitoring
