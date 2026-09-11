#!/usr/bin/env python3
"""Strict Android sing-box profile export. No server private keys or direct fallback."""
import argparse
import base64
import ipaddress
import json
import os
from pathlib import Path
import re
import ssl
import tempfile
from urllib.parse import urlparse
import uuid

KINDS = ('hy2-native', 'tuic', 'hy2-obfs', 'reality')
COMMON = {'id', 'kind', 'server_ip', 'port', 'server_name', 'certificate'}
FIELDS = {
    'hy2-native': COMMON | {'password'},
    'hy2-obfs': COMMON | {'password', 'obfs_password'},
    'tuic': COMMON | {'uuid', 'password', 'congestion_control', 'udp_relay_mode'},
    'reality': (COMMON - {'certificate'}) | {'uuid', 'public_key', 'short_id'},
}


def required_text(value, field, maximum=4096):
    if not isinstance(value, str) or not value or len(value) > maximum or '\x00' in value:
        raise ValueError(f'Invalid {field}')
    return value


def hostname(value):
    value = required_text(value, 'server_name', 253)
    if not re.fullmatch(r'(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[A-Za-z]{2,63}', value):
        raise ValueError('server_name must be a DNS hostname')
    return value.lower()


def uuid_value(value):
    return str(uuid.UUID(required_text(value, 'uuid', 36)))


def outbound(endpoint):
    if not isinstance(endpoint, dict) or endpoint.get('kind') not in KINDS:
        raise ValueError('Unknown transport kind')
    kind = endpoint['kind']
    if set(endpoint) - FIELDS[kind]:
        raise ValueError('Unknown endpoint fields; server secrets and insecure TLS are not accepted')
    tag = required_text(endpoint.get('id'), 'id', 80)
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}', tag) or tag in {'XFREEDOM', 'AUTO', 'dns-remote', 'tun-in'}:
        raise ValueError('Invalid or reserved endpoint id')
    server = str(ipaddress.ip_address(required_text(endpoint.get('server_ip'), 'server_ip', 45)))
    port = endpoint.get('port')
    if type(port) is not int or not 1 <= port <= 65535:
        raise ValueError('port must be an integer from 1 to 65535')
    tls = {'enabled': True, 'server_name': hostname(endpoint.get('server_name')), 'insecure': False}
    cert = endpoint.get('certificate')
    if cert is not None:
        cert = required_text(cert, 'certificate', 65536)
        if 'PRIVATE KEY' in cert or cert.count('-----BEGIN CERTIFICATE-----') != 1:
            raise ValueError('Expected one public PEM certificate')
        ssl.PEM_cert_to_DER_cert(cert)
        tls['certificate'] = cert
    result = {'tag': tag, 'server': server, 'server_port': port, 'tls': tls,
              'connect_timeout': '10s'}
    if kind.startswith('hy2'):
        result.update(type='hysteria2', password=required_text(endpoint.get('password'), 'password'))
        if kind == 'hy2-obfs':
            result['obfs'] = {'type': 'salamander', 'password': required_text(endpoint.get('obfs_password'), 'obfs_password')}
    elif kind == 'tuic':
        cc = endpoint.get('congestion_control', 'cubic')
        relay = endpoint.get('udp_relay_mode', 'native')
        if cc not in ('cubic', 'new_reno', 'bbr') or relay not in ('native', 'quic'):
            raise ValueError('Invalid TUIC options')
        result.update(type='tuic', uuid=uuid_value(endpoint.get('uuid')),
                      password=required_text(endpoint.get('password'), 'password'),
                      congestion_control=cc, udp_relay_mode=relay, heartbeat='10s', zero_rtt_handshake=False)
    else:
        public = required_text(endpoint.get('public_key'), 'public_key', 43)
        if not re.fullmatch(r'[A-Za-z0-9_-]{43}', public) or len(base64.urlsafe_b64decode(public + '=')) != 32:
            raise ValueError('REALITY public key must encode 32 bytes')
        short = required_text(endpoint.get('short_id'), 'short_id', 16)
        if not re.fullmatch(r'(?:[A-Fa-f0-9]{2}){1,8}', short):
            raise ValueError('REALITY short_id must be even-length hexadecimal')
        tls.update(utls={'enabled': True, 'fingerprint': 'chrome'},
                   reality={'enabled': True, 'public_key': public, 'short_id': short})
        result.update(type='vless', uuid=uuid_value(endpoint.get('uuid')), flow='xtls-rprx-vision', packet_encoding='xudp')
    return result


def build_profile(catalog, probe_url='https://www.gstatic.com/generate_204'):
    if not isinstance(catalog, dict) or set(catalog) != {'schema', 'endpoints'} or type(catalog['schema']) is not int or catalog['schema'] != 1:
        raise ValueError('Expected schema 1 and endpoints only')
    endpoints = catalog['endpoints']
    if not isinstance(endpoints, list) or not 1 <= len(endpoints) <= 32:
        raise ValueError('Expected 1 to 32 configured endpoints')
    parsed = urlparse(probe_url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise ValueError('Probe URL must use HTTPS without credentials or fragment')
    transports = [outbound(e) for e in endpoints]
    tags = [e['tag'] for e in transports]
    if len(set(tags)) != len(tags):
        raise ValueError('Duplicate endpoint id')
    # Distinct UDP listeners cannot own one IP/port. TCP REALITY may share the port number.
    listeners = [(e['server'], e['server_port'], 'tcp' if e['type'] == 'vless' else 'udp') for e in transports]
    if len(set(listeners)) != len(listeners):
        raise ValueError('Duplicate transport listener: use separate IPs or ports')
    transports.sort(key=lambda o: KINDS.index(next(e['kind'] for e in endpoints if e['id'] == o['tag'])))
    tags = [e['tag'] for e in transports]
    return {
        'log': {'level': 'warn', 'timestamp': True},
        'dns': {'servers': [{'type': 'https', 'tag': 'dns-remote', 'server': '1.1.1.1',
                            'path': '/dns-query', 'detour': 'XFREEDOM',
                            'tls': {'enabled': True, 'server_name': 'cloudflare-dns.com', 'insecure': False}}],
                'final': 'dns-remote', 'strategy': 'prefer_ipv4'},
        'inbounds': [{'type': 'tun', 'tag': 'tun-in', 'address': ['172.19.0.1/30', 'fdfe:dcba:9876::1/126'],
                      'mtu': 1280, 'auto_route': True, 'strict_route': True, 'stack': 'mixed'}],
        'outbounds': [{'type': 'selector', 'tag': 'XFREEDOM', 'outbounds': ['AUTO', *tags], 'default': 'AUTO'},
                      {'type': 'urltest', 'tag': 'AUTO', 'outbounds': tags, 'url': probe_url,
                       'interval': '1m', 'tolerance': 120, 'idle_timeout': '30m', 'interrupt_exist_connections': False},
                      *transports],
        'route': {'auto_detect_interface': True, 'final': 'XFREEDOM',
                  'rules': [{'port': 53, 'action': 'hijack-dns'}]},
    }


def solo_catalog(state, certificate, port=443):
    # Project only required client credentials. Do not copy the state object.
    common = {'server_ip': state['public_ip'], 'port': port, 'server_name': state['sni']}
    return {'schema': 1, 'endpoints': [
        {**common, 'id': 'hy2-obfs', 'kind': 'hy2-obfs', 'password': state['hy_password'],
         'obfs_password': state['hy_obfs'], 'certificate': certificate},
        {**common, 'id': 'reality', 'kind': 'reality', 'uuid': state['uuid'],
         'public_key': state['public_key'], 'short_id': state['short_id']},
    ]}


def write_private(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix='.xf-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--probe-url', default='https://www.gstatic.com/generate_204')
    args = parser.parse_args()
    try:
        write_private(args.output, build_profile(json.loads(args.catalog.read_text()), args.probe_url))
    except (ValueError, KeyError, TypeError):
        parser.exit(2, 'Invalid catalog; no profile written.\n')
    print('Android profile written with private file permissions; credentials not printed.')
