# XFreedom Android Superstack — presentation

## Slide 1 — Mission

XFreedom becomes one Android app for resilient lawful connectivity: one button, native network probes, automatic transport selection, verified tunnel, post-connect app checks.

## Slide 2 — What we are combining

TLS Tunnel style:

- one-tap VPN;
- TLS 1.3 security focus;
- private server mode;
- IPv6 readiness;
- server/access status;
- battery-conscious mobile UX.

HTTP Injector style:

- multi-protocol client;
- SSH, proxy, SSL/TLS, DNS tunnel, Shadowsocks, V2Ray/Xray, Hysteria, WireGuard;
- host checker / IP hunter;
- payload generator;
- split tunneling and DNS changer;
- provider/export mode.

XFreedom addition:

- evidence-based decision engine;
- regional memory;
- transport shutdown / allowlist handling;
- no fake DPI claims from weak probes;
- server control center and Qdrant memory.

## Slide 3 — Differentiation

Legacy injector apps are mostly manual configuration tools. XFreedom is an adaptive system:

measure → classify → select → connect → verify → learn.

## Slide 4 — Android architecture

- Kotlin + Jetpack Compose.
- Android VpnService.
- ForegroundService.
- Native probes.
- DecisionEngine.
- Core adapters: sing-box, Xray, Hysteria2, TUIC, SSH/TLS payload.
- Signed config bundles.
- Local encrypted storage.

## Slide 5 — Transport matrix

- HY2 Native: best when UDP/443 and QUIC work.
- TUIC v5: QUIC fallback.
- HY2 Obfs: when native HY2 is degraded.
- VLESS Reality: TCP/443 fallback.
- XHTTP/WebSocket TLS: compatibility.
- SSH/TLS payload: legacy fallback.
- DNS tunnel: emergency low-bandwidth mode.

## Slide 6 — Decision engine

Inputs:

- NetworkSnapshot;
- NodeCapabilities;
- ClientCapabilities;
- ProbeResults;
- HistoricalMeasurements.

Output:

- primary transport;
- fallbacks;
- reason;
- confidence;
- parameters;
- action: connect, collect more evidence, switch uplink.

## Slide 7 — Evidence rules

- Browser failure is symptom only.
- Native DNS/TCP/TLS/UDP/QUIC probes are required for transport choice.
- One failed QUIC endpoint is not generic UDP proof.
- Confirmed transport shutdown or allowlist mode means switch uplink, not endless VPN retries.

## Slide 8 — UX

Main screen:

- black cosmos style;
- single large CONNECT button;
- route and confidence;
- app checks for WhatsApp, Telegram, YouTube, Instagram, TikTok.

Advanced screen:

- import/export;
- DNS;
- split tunneling;
- provider mode;
- diagnostics export.

## Slide 9 — Backend

- Control Center.
- PostgreSQL.
- Qdrant memory.
- Node health.
- Signed node list.
- Config generation and revocation.
- Regional snapshot analytics.

## Slide 10 — Build roadmap

1. Android shell and VpnService permission.
2. Native probes and local decision engine.
3. Profile generators.
4. First real core integration.
5. HY2/TUIC/REALITY integrations.
6. Backend signed config endpoint.
7. Play-ready privacy/security hardening.

## Slide 11 — First APK scope

The first build is not a fake VPN mockup. It must include:

- installable Android debug APK;
- VPN permission flow;
- diagnostics screen;
- decision engine tests;
- profile generation tests;
- honest states: idle, probing, ready, connecting, connected, failed.

## Slide 12 — Definition of success

A user can press one button and the app will either connect with verified evidence or honestly explain why more evidence / another network is required.
