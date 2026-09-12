#!/usr/bin/env python3
"""XFreedom network probe agent.

Collects metadata-free DNS/TCP/TLS/HTTP/QUIC reachability evidence for the
current network and prints a NetworkSnapshot-compatible JSON document.

It does not capture packet payloads, browsing history, credentials, or the
client public IP. Region/operator labels are optional explicit arguments.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
import socket
import ssl
import subprocess
import sys
import time
from dataclasses import dataclass
from typing import Callable, Literal

ProbeState = Literal["pass", "fail", "unknown"]
TIMEOUT = 3.0


@dataclass(frozen=True)
class AppTarget:
    id: str
    host: str
    url: str
    quic: bool = False


APP_TARGETS = (
    AppTarget("whatsapp", "web.whatsapp.com", "https://web.whatsapp.com/"),
    AppTarget("tiktok", "www.tiktok.com", "https://www.tiktok.com/"),
    AppTarget("youtube", "www.youtube.com", "https://www.youtube.com/generate_204", True),
    AppTarget("instagram", "www.instagram.com", "https://www.instagram.com/"),
    AppTarget("telegram", "telegram.org", "https://telegram.org/"),
)


def state_from(fn: Callable[[], None]) -> ProbeState:
    try:
        fn()
        return "pass"
    except Exception:
        return "fail"


def probe_dns(host: str) -> ProbeState:
    def run() -> None:
        rows = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        if not rows:
            raise RuntimeError("no addresses")

    return state_from(run)


def probe_tcp(host: str, port: int = 443) -> ProbeState:
    def run() -> None:
        with socket.create_connection((host, port), timeout=TIMEOUT):
            return

    return state_from(run)


def probe_tls(host: str, connect_host: str | None = None) -> ProbeState:
    def run() -> None:
        context = ssl.create_default_context()
        with socket.create_connection((connect_host or host, 443), timeout=TIMEOUT) as raw:
            raw.settimeout(TIMEOUT)
            with context.wrap_socket(raw, server_hostname=host) as tls:
                if not tls.version():
                    raise RuntimeError("TLS version unavailable")

    return state_from(run)


def curl_available() -> bool:
    return shutil.which("curl") is not None


def run_curl(args: list[str], timeout: float = 6.0) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["curl", *args],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=False,
    )


def probe_http(url: str) -> ProbeState:
    if not curl_available():
        return "unknown"
    try:
        result = run_curl(
            [
                "--silent",
                "--show-error",
                "--location",
                "--output",
                "/dev/null",
                "--write-out",
                "%{http_code}",
                "--connect-timeout",
                "2",
                "--max-time",
                "5",
                "--range",
                "0-0",
                url,
            ]
        )
    except Exception:
        return "fail"

    code = result.stdout.strip()
    # Any real HTTP response, including 3xx/4xx/5xx, proves that an HTTP
    # exchange completed. We are measuring reachability, not application auth.
    return "pass" if result.returncode == 0 and code.isdigit() and code != "000" else "fail"


def curl_has_http3() -> bool:
    if not curl_available():
        return False
    try:
        result = run_curl(["--version"], timeout=2.0)
    except Exception:
        return False
    return result.returncode == 0 and "HTTP3" in result.stdout.upper()


def probe_quic(url: str) -> ProbeState:
    if not curl_has_http3():
        return "unknown"
    try:
        result = run_curl(
            [
                "--http3-only",
                "--silent",
                "--show-error",
                "--output",
                "/dev/null",
                "--connect-timeout",
                "2",
                "--max-time",
                "5",
                url,
            ]
        )
    except Exception:
        return "fail"
    return "pass" if result.returncode == 0 else "fail"


def timed(fn: Callable[[], ProbeState]) -> tuple[ProbeState, int]:
    started = time.monotonic()
    value = fn()
    return value, round((time.monotonic() - started) * 1000)


def app_probe(target: AppTarget) -> dict[str, object]:
    dns, dns_ms = timed(lambda: probe_dns(target.host))
    tcp, tcp_ms = timed(lambda: probe_tcp(target.host))
    tls, tls_ms = timed(lambda: probe_tls(target.host))
    http, http_ms = timed(lambda: probe_http(target.url))
    quic: ProbeState = probe_quic(target.url) if target.quic else "unknown"
    return {
        "id": target.id,
        "dns": dns,
        "tcp443": tcp,
        "tls": tls,
        "http": http,
        "quic": quic,
        "latencyMs": {
            "dns": dns_ms,
            "tcp443": tcp_ms,
            "tls": tls_ms,
            "http": http_ms,
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect an XFreedom NetworkSnapshot")
    parser.add_argument("--access-type", choices=("wifi", "ethernet", "mobile", "unknown"), default="unknown")
    parser.add_argument("--operator")
    parser.add_argument("--asn")
    parser.add_argument("--region")
    parser.add_argument("--city")
    parser.add_argument("--output", help="Optional path to write JSON in addition to stdout")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    # Use an IP for the TCP control so DNS failure does not automatically make
    # the TCP control fail. TLS still validates cloudflare.com with SNI.
    control_dns, control_dns_ms = timed(lambda: probe_dns("cloudflare.com"))
    control_tcp, control_tcp_ms = timed(lambda: probe_tcp("1.1.1.1"))
    control_tls, control_tls_ms = timed(lambda: probe_tls("cloudflare.com", "1.1.1.1"))
    control_quic, control_quic_ms = timed(lambda: probe_quic("https://cloudflare.com/"))

    # A successful QUIC handshake proves working UDP/443. A failed single-host
    # QUIC probe is not enough to prove generic UDP blocking, so keep UDP as
    # unknown in that case and let the decision engine request more evidence.
    control_udp: ProbeState = "pass" if control_quic == "pass" else "unknown"

    snapshot: dict[str, object] = {
        "observedAt": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "accessType": args.access_type,
        "control": {
            "dns": control_dns,
            "tcp443": control_tcp,
            "tls": control_tls,
            "udp443": control_udp,
            "quic": control_quic,
        },
        "apps": [app_probe(target) for target in APP_TARGETS],
        "probeMeta": {
            "agent": "xfreedom-network-probe",
            "version": 1,
            "curlHttp3": curl_has_http3(),
            "latencyMs": {
                "controlDns": control_dns_ms,
                "controlTcp443": control_tcp_ms,
                "controlTls": control_tls_ms,
                "controlQuic": control_quic_ms,
            },
            "privacy": "no packet payloads, browsing history, credentials, or public IP collected",
        },
    }

    for key, value in (
        ("operator", args.operator),
        ("asn", args.asn),
        ("region", args.region),
        ("city", args.city),
    ):
        if value:
            snapshot[key] = value

    text = json.dumps(snapshot, ensure_ascii=False, indent=2)
    print(text)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as handle:
            handle.write(text + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
