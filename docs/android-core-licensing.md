# Android tunnel-core licensing decision

XFreedom should not silently combine incompatible or unexpectedly copyleft components into a release APK.

## Verified upstream licenses

- Xray-core: MPL-2.0.
- Hysteria: MIT.
- WireGuard Android tunnel library: Apache-2.0; userspace wireguard-go is MIT.
- sing-box Android `libbox`: GPL-3.0.

## Current repository state

There is no top-level `LICENSE` file in this repository at the time this document was added.

Because of that, the Android bootstrap does **not** yet embed `libbox` even though it is technically attractive and supports many transports in one core. Shipping a GPL-3.0 library inside an APK without deciding how the application itself will be licensed would be irresponsible.

## Recommended production split

Use an adapter boundary:

```text
TunnelBackend
  |-- XrayBackend          # VLESS / Reality / VMess / XHTTP / Shadowsocks class
  |-- Hysteria2Backend     # QUIC / UDP
  |-- WireGuardBackend     # WireGuard Android tunnel library
  |-- SshTlsBackend        # SSH / TLS compatibility mode
  `-- DnsTunnelBackend     # emergency DNSTT/SlowDNS mode
```

This keeps protocol choice independent from the Android UI and `VpnService`, and avoids coupling the entire app to one native core.

Before a public release:

1. choose and add the XFreedom application license;
2. pin every native-core version and SHA256;
3. include all required notices/licenses in the APK and repository;
4. generate an SBOM for release artifacts;
5. run dependency/license scanning in CI.
