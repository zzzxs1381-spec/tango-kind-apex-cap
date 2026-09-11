# XFreedom network measurement contract

XFreedom must distinguish observation from inference. A failed browser request is not proof of DNS poisoning, TCP blocking, TLS/SNI filtering, TSPU/DPI, or a regulator action.

## Evidence tiers

### Tier 0 — browser-only

The web UI may test a small public endpoint and an independent DoH resolver. This is useful for a symptom indicator only.

Allowed conclusions:

- browser endpoint responded;
- browser endpoint did not respond before timeout;
- independent DoH returned or did not return an A record.

Not allowed from Tier 0 alone:

- `DNS blocked`;
- `TCP blocked`;
- `SNI/DPI detected`;
- `RKN/TSPU confirmed`;
- automatic HY2/TUIC/REALITY selection.

### Tier 1 — system/native probes

`infra/agent/network-probe.py` collects independent DNS, TCP/443, TLS, HTTP and optional QUIC evidence. It does not capture packet payloads, browsing history, credentials, or public IP.

Example:

```bash
python3 infra/agent/network-probe.py \
  --access-type mobile \
  --operator "Volna" \
  --region "Crimea" \
  --city "Simferopol" \
  --output snapshot.json
```

Operator/ASN/region/city are labels supplied by the operator of the authorized probe. They are not inferred or verified by this script.

### Tier 2 — reproducible packet-level / multi-vantage evidence

Packet traces, multiple control targets, OONI-style repeated measurements, operator telemetry or independently reproduced observations are required before a specific censorship mechanism is labelled high-confidence.

## NetworkSnapshot

The decision engine consumes a snapshot containing:

- observation timestamp;
- access type and optional operator/ASN/region/city;
- control DNS, TCP/443, TLS, UDP/443 and QUIC states;
- per-application DNS/TCP/TLS/HTTP/QUIC states;
- optional independent indicators such as confirmed transport shutdown or confirmed allowlist mode.

States are `pass`, `fail`, or `unknown`. `unknown` must remain distinct from `fail`.

## Important QUIC limitation

The Python probe uses `curl --http3-only` only when the installed curl reports HTTP/3 support. A successful QUIC request proves a working UDP/443 path for that test. A failed single-host QUIC request does **not** by itself prove generic UDP blocking, so the collector keeps the generic `udp443` state as `unknown` unless QUIC succeeds.

## Decision rules

The engine may currently choose:

- Hysteria2 Native when fresh system evidence confirms UDP/443 and QUIC;
- TUIC v5 and Hysteria2 Obfuscated as QUIC-family fallbacks;
- VLESS Reality when UDP is known unavailable while TCP/443 and TLS are healthy;
- no tunnel at all when a transport shutdown or allowlist-only mode is confirmed.

If evidence is incomplete, the correct result is `collect_more_evidence`, not a guessed transport.

## Regional use

For Crimea, the Caucasus, Moscow and other Russian regions, measurements must be stored separately by timestamp, operator/ASN and access type. A result observed on one SIM, one ISP or one date must not be promoted into a permanent rule for the entire region.
