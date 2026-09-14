# xf-tls1 native extension

This extends the existing Android app in `android/`. It does not redeploy xservis.app.

## Local proof

```sh
node --test native-edge/edge.test.mjs
node native-edge/selftest.mjs
```

Selftest creates a temporary EC self-signed certificate, uses TLS 1.3 / ALPN xf-tls1 / SNI,
checks a SHA-256 DER certificate pin, authenticates and sends HTTP through OPEN to a local echo.
It deletes temporary credentials and leaves a shared edge running when called from the API.
No external internet, phone, server or regional connectivity is implied by this result.

## Server integration

Apply `native-edge/schema.sql` to the existing Postgres database using the normal migration procedure.
Use Node 22+ and OpenSSL. `pg` is already a dependency of the existing project.
Set environment values in the existing service manager (never commit secrets):

- `XF_NATIVE_TOKEN_SECRET`: at least 32 random bytes, stable per deployment.
- `XF_NATIVE_STATE_DIR`: persistent private directory for the certificate and private key.
- `XF_NATIVE_SNI`: configured SNI, defaults to `www.microsoft.com` (no third-party affiliation or camouflage guarantee).
- `XF_NATIVE_EDGE_PORT`: loopback TLS port, default 9443.
- `XF_NATIVE_API_PORT`: loopback HTTP API, default 9081.
- `DATABASE_URL`: existing Postgres connection.
- `XF_NATIVE_API_ORIGIN`: actual public HTTPS API origin, e.g. https://xservis.app.
- `XF_NATIVE_PUBLIC_IP`, `XF_NATIVE_PUBLIC_PORT`: verified external TCP ingress forwarding raw TLS to the edge.
- `XF_NATIVE_API_URL=http://127.0.0.1:9081`: enables the additive web route proxy.

Run `node native-edge/api.mjs` in a persistent process alongside the unchanged site.
API readiness does not start the edge; `/api/native/edge` starts it lazily and performs a cached single-flight selftest.
No public TCP listener is created. A phone cannot connect to a server's loopback without separately provisioned ingress.
Do not deploy this sidecar inside a serverless request handler.

For an operator-approved, already verified subject, `node native-edge/enroll.mjs SUBJECT`
issues an enrollment JSON to stdout. Treat that output as a secret; deliver only to the intended device.
This is a manual enrollment path, not a replacement for the site's account/trial/entitlement system.
The issuer deliberately has no public anonymous endpoint. The enrollment expires in 24 hours.
Rotation/re-enrollment is currently required after expiry; no persistent subscription access is implied.

The API strips payloads and target metadata from stage events and uses Postgres transactions for ordering.
Events are native-reported, not hardware-attested; `webConnected` is always false.
If Postgres is unavailable, writes fail explicitly. Qdrant/AIMA are not in the tunnel critical path.

## Android

Import the enrollment JSON in Settings. The original diagnostic/REALITY/WireGuard screen remains under
“Диагностика и другие профили”. TLS requires Android 10+; API level 26 builds retain other backends.
Always-On restart loads the encrypted enrollment. System lockdown must be enabled by the user for
protection when Android stops the VPN process. Runtime connection booleans are not trusted after restart.

TUN → pinned Xray/gVisor TCP stack → authenticated loopback SOCKS5 CONNECT → xf-tls1 OPEN.
DNS from TUN is rewritten to TCP DNS through the same SOCKS outbound; other UDP is dropped.
IPv6 is not configured and is blocked by Android's VPN family policy, not advertised as supported.
No application-wide VPN exclusion or allowBypass is used.

The bridge retains an original TUN descriptor during reconnect. A duplicate belongs to each core run
and is closed by the caller after Xray stops (the pinned AndroidTun.Close is a no-op).
One TCP stream uses one TLS connection; no multiplexing throughput claim is made.
The engine retries the same configured route with capped exponential delay and jitter.
It does not invent alternate nodes, transports or diagnostics classifications. The fallbacks array is empty
until another verified route is provisioned. Endpoint reachability is tested by live pinned handshake.

No device test has been claimed. Required device checks: full TLS path with actual ingress,
DNS and HTTPS on the VPN Network, process death with system lockdown, Always-On reboot,
Wi-Fi/LTE change, cancellation, fd/resource leak tests, sustained transfer, and app reachability.

## Wire format

See `docs/xf-tls1-master-prompt-2026-09-13.md`. CLOSE is a directional EOF;
responses can still arrive after a sender half-closes. The server has bounded frames,
streams, sessions, auth/idle timeouts and queues. Normal sessions cannot OPEN private IPv4,
loopback, metadata or any IPv6 address. Only short-lived selftest tokens have an exact echo allowlist.
The initial build supports TCP-only xf-tls1; it is not a clone of any third-party APK.

## Sources checked for integration

- https://developer.android.com/develop/connectivity/vpn
- https://xtls.github.io/en/config/inbounds/tun.html
- https://github.com/XTLS/Xray-core/blob/v26.9.9/proxy/tun/tun_android.go
- https://github.com/XTLS/Xray-core/blob/v26.9.9/infra/conf/dns_proxy.go
- https://xtls.github.io/en/config/outbounds/socks.html
