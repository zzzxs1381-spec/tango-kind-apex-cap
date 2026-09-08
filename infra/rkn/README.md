# XFreedom RKN-resilient transport layer

This directory is the censorship-resilient transport and one-shot platform deployment layer for the three-node XFreedom cluster.

## Topology

- **edge** — Russian entry node, mesh address `10.77.0.1`
- **core1** — foreign exit, mesh address `10.77.0.2`
- **core2** — foreign exit / failover, mesh address `10.77.0.3`

The public client paths are intentionally diverse:

1. **VLESS + XTLS Vision + REALITY over TCP/443** — primary path. The installer probes a small role-specific target set with `xray tls ping` instead of hard-coding one REALITY camouflage target.
2. **Hysteria 2 + Salamander over UDP/443** — independent QUIC/UDP fallback. Self-signed TLS is pinned in the generated URI with `pinSHA256`.
3. **AmneziaWG** — private inter-server mesh. Plain WireGuard is not used for the RU-to-foreign mesh because its fixed protocol signature is comparatively easy to classify.

On the edge node, Xray sends user traffic to private SOCKS5 inbounds on the two foreign cores over the encrypted AmneziaWG mesh and uses Xray observatory + leastPing for health-aware selection. Each foreign core can also be used directly by clients if the Russian edge is unavailable.

## Why this shape

Current Russian blocking is not one mechanism. Measurements and reporting show combinations of DNS manipulation, TLS interference after ClientHello, connection resets/timeouts, service-specific blocks, VPN blocking, mobile-data shutdowns, and allowlist-style restrictions. No single tunnel can be expected to survive every network and every region.

REALITY provides a TCP/TLS-like path, Hysteria 2 provides a separate QUIC/UDP path, and AmneziaWG removes the obvious standard-WireGuard signature from the private mesh. The three are independent enough that one failure mode does not automatically kill the whole cluster.

## One-shot installation

Run the controller on any Ubuntu 22.04+ machine that can SSH to all three VPS:

```bash
XF_REF=main ./cluster-bootstrap.sh EDGE_PUBLIC_IP CORE1_PUBLIC_IP CORE2_PUBLIC_IP
```

The script asks for all three root passwords with hidden input. Passwords are kept only in controller process memory and are never written to this repository. It then:

- verifies SSH and inventories the servers;
- refuses to kill an unknown service already occupying port 443;
- backs up existing Xray/Hysteria/AmneziaWG configs;
- installs AmneziaWG, Xray and Hysteria 2;
- generates per-node keys and secrets;
- generates pairwise AmneziaWG preshared keys;
- builds the full `10.77.0.0/24` mesh;
- starts VLESS/REALITY TCP 443 and Hysteria2 UDP 443;
- enables a one-minute systemd watchdog;
- checks the mesh, services and listeners;
- deploys Docker/Compose on the three nodes without replacing an existing Docker installation;
- deploys PostgreSQL + Qdrant + XFreedom app on core1;
- deploys a warm XFreedom app replica on core2;
- deploys the public Control Center edge proxy with app failover;
- verifies core health and the public edge endpoint;
- collects all client links into `/root/xfreedom-rkn-controller/client-links.txt`.

## Client policy

For phones and desktops, use a client that supports **TUN/full-tunnel mode** if the goal is the whole Internet rather than a browser-only proxy. Keep at least two profiles enabled/available: REALITY as the default and Hysteria2 as an alternate. The installer emits `chrome`, `firefox`, and `qq` REALITY fingerprint variants for troubleshooting carrier-specific TLS fingerprint filtering. Keep a direct foreign-core profile as a fallback to the Russian edge.

Applications such as WhatsApp, Telegram, YouTube and Instagram do not need special server-side routing rules when the device is in full-tunnel mode; all their TCP/UDP/DNS traffic is carried through the selected tunnel.

## Hard limit: physical/mobile shutdowns

A transport cannot create connectivity when an ISP is not carrying arbitrary packets at all. During complete mobile-data shutdowns or strict allowlist-only periods, the endpoint itself may be unreachable regardless of VLESS, Hysteria, WireGuard or any other protocol. In that situation, use an available wired/Wi-Fi connection or another functioning access network.

## After the first successful deployment

The root passwords used for bootstrap are temporary credentials. Install and verify SSH public-key access, rotate the passwords, and only then disable password authentication. Do not disable password SSH before key login is confirmed or you can lock yourself out.


## Platform result

After a successful run:

- Control Center listens only on edge `127.0.0.1:8080` and is not publicly exposed.
- core1 hosts PostgreSQL, Qdrant, and the primary XFreedom application.
- core2 hosts the application replica and uses PostgreSQL over the private AmneziaWG mesh.
- edge health-checks/proxies the two core application nodes.
- application and transport watchdogs are enabled as independent systemd timers.
- the generated database and Better Auth secrets remain only in root-readable VPS `.env` files.


## Open the private Control Center

From your workstation, create an SSH tunnel to the edge node:

```bash
ssh -L 8080:127.0.0.1:8080 root@EDGE_PUBLIC_IP
```

Then open `http://127.0.0.1:8080/` locally. The HTTP hop exists only inside the encrypted SSH connection; the server does not publish port 8080 or port 80 to the Internet.
