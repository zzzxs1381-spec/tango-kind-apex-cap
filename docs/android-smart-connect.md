# Android Smart Connect

`XFreedom` selects only transports that are both supported by the current APK and configured with an in-memory profile.

Current runnable Android backends:

- `VLESS_REALITY` through bundled `libXray`;
- `WIREGUARD` through the official Android `GoBackend` compatibility path.

The network Decision Engine may still describe Hysteria2/TUIC as ideal transports, but the client-facing decision filters that order through actual runtime capabilities. Missing backends are never presented as connected.

## One-tap flow

1. Import a VLESS REALITY JSON and/or WireGuard `.conf`.
2. Tap **Подключить**.
3. The client collects DNS/TCP/TLS/HTTP measurements.
4. The capability-aware Decision Engine selects a runnable configured backend.
5. Android VPN permission is requested only when needed.
6. The selected backend is started.
7. XFreedom runs post-connect control/application probes and keeps, rejects, or marks the tunnel as ambiguous.

Profiles stay in process memory for the current session. The UI does not write imported client secrets to persistent storage.
