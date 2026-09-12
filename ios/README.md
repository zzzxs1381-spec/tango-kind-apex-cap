# XFreedom iOS field release

This directory contains the first iPhone/iPad field-release implementation.

## Runtime path

SwiftUI app -> NETunnelProviderManager -> NEPacketTunnelProvider -> SwiftyXrayKit `XRayTunnel` -> local Xray SOCKS inbound -> tun2socks packet bridge -> Xray REALITY outbound.

The initial field build intentionally supports only imported VLESS/REALITY profiles. It does not claim Hysteria2/TUIC/AWG support until those native runtimes are linked and device-tested.

## Why SwiftyXrayKit for the first field build

Apple's public Packet Tunnel API exposes `NEPacketTunnelFlow`, not a documented raw utun file descriptor. SwiftyXrayKit 1.1.0 works with `NEPacketTunnelFlow` directly: its `XRayTunnel` creates a local Xray SOCKS inbound and bridges packets with its tun2socks/Outline adapter. XFreedom therefore does not use KVC/private utun descriptor extraction.

Current trade-off: SwiftyXrayKit 1.1.x is based on Xray-core v26.3.27. Android already uses newer libXray. After the first iPhone packet-forwarding test, XFreedom should own/pin an updated Apple bridge build based on current Xray-core while preserving the same public NetworkExtension architecture.

The field target is built with Xcode 26 and current iOS SDKs, but temporarily uses Swift 5 language mode because SwiftyXrayKit 1.1.0 is not Swift-6 strict-concurrency clean around `NEPacketTunnelFlow`. This avoids adding unsafe retroactive `Sendable` declarations to Apple framework types. Move back to Swift 6 when the bridge is upgraded.

## Build without signing

```bash
brew install xcodegen
cd ios
xcodegen generate
xcodebuild -project XFreedomIOS.xcodeproj \
  -scheme XFreedomIOS \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  build
```

## Profile storage note

For the first field build the VLESS/REALITY share link is stored in the system-managed `NETunnelProviderManager` configuration so the PacketTunnel extension can receive it. Production hardening should move credential-bearing material into Keychain/App Group Keychain storage and keep only a profile identifier in provider configuration.

## Physical device requirements

A real system VPN field test needs:

- paid Apple Developer Program access;
- Network Extensions capability with `packet-tunnel-provider`;
- matching signing/provisioning for the app and PacketTunnel extension;
- a physical iPhone/iPad;
- for public App Store VPN distribution, an Apple Developer organization account and the VPN privacy declarations required by App Review Guideline 5.4.

## Definition of done for the first iPhone transport

The iPhone transport is not considered working until all of these are observed on a physical device:

1. the PacketTunnel extension starts;
2. REALITY reaches the XFreedom node;
3. TCP and UDP traffic traverse the tunnel;
4. DNS resolves through the tunnel without a loop/leak;
5. Safari plus the priority app probes work after connect;
6. disconnect restores the normal network;
7. Wi-Fi/cellular change is tested before self-healing is marked complete.
