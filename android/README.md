# XFreedom Android

Native Android client for XFreedom.

## Current implementation

This directory is a real standalone Android project, not a web wrapper.

Implemented now:

- Kotlin + Jetpack Compose UI;
- Android `VpnService` permission and foreground-service lifecycle;
- native access-type detection (Wi-Fi / mobile / Ethernet);
- DNS, TCP/443, TLS and HTTPS endpoint probes;
- priority probes for WhatsApp, TikTok, YouTube, Instagram and Telegram;
- evidence-based network classifier;
- transport decision contract for Hysteria2, TUIC v5, VLESS Reality, WireGuard and SSH/TLS fallbacks;
- secure Hysteria2 / TUIC / Reality profile generators;
- unit tests for evidence decisions and profile safety.

Not yet claimed as implemented:

- packet forwarding through a production native tunnel core;
- generic UDP/443 / QUIC measurement;
- DNSTT/SlowDNS runtime;
- SSH payload/injector runtime;
- WireGuard runtime;
- per-app split tunneling;
- provider-mode encrypted exports;
- post-connect app verification through the active tunnel.

The app deliberately refuses to establish an empty TUN until a concrete audited tunnel core is linked. An empty TUN would black-hole device traffic and create a false "VPN connected" state.

## Build

Requirements:

- JDK 17
- Android SDK platform 37
- Android SDK Build Tools 36.0.0
- Gradle 9.6.0

From the repository root:

```bash
gradle -p android :app:testDebugUnitTest :app:assembleDebug
```

APK output:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Architecture

```text
Compose UI
   |
   +--> SystemProbeEngine
   |      DNS / TCP / TLS / HTTP
   |             |
   |             v
   |       NetworkSnapshot
   |             |
   |             v
   |       DecisionEngine
   |             |
   |    primary + fallbacks
   |
   +--> Android VpnService
              |
              v
       TunnelBackend interface
              |
      +-------+--------+---------+
      |                |         |
   Xray/Reality     Hysteria2  WireGuard
      |                |         |
      +------ future audited adapters
```

## Evidence policy

A timeout is a symptom, not proof of censorship. The Android client therefore keeps `UNKNOWN` separate from `FAIL`, does not infer generic UDP blocking from a blind UDP packet, and does not label a specific regulator/DPI mechanism without independent evidence.

## Core licensing

The repository currently has no top-level license file. For that reason no GPL native core is silently embedded in this first implementation. Core selection and redistribution obligations must be explicit before shipping a release build.
