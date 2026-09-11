#!/usr/bin/env python3
"""Generate persistent credentials and server/client configs without shell eval."""
import argparse
import base64
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
from urllib.parse import urlencode
import uuid

PRIVATE = ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8',
           '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16',
           '224.0.0.0/4', '240.0.0.0/4', '::/128', '::1/128',
           'fc00::/7', 'fe80::/10', 'ff00::/8']


def valid_ip(value, allow_local=False):
    address = ipaddress.ip_address(value)
    if address.version != 4 or (not allow_local and not address.is_global):
        raise ValueError('Specify the new VPS public IPv4 address')
    return str(address)


def valid_sni(value):
    if len(value) > 253 or not re.fullmatch(r'(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}', value):
        raise ValueError('REALITY target must be a DNS hostname, without port or URL')
    return value.lower()


def write(path, value, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(value, indent=2, ensure_ascii=False) + '\n' if not isinstance(value, str) else value
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(data)
    temporary.chmod(mode)
    os.replace(temporary, path)


def create_state(xray, ip, sni):
    output = subprocess.check_output([str(xray), 'x25519'], text=True)
    values = {k.strip().lower().replace(' ', ''): v.strip()
              for k, v in (line.split(':', 1) for line in output.splitlines() if ':' in line)}
    private = values.get('privatekey')
    public = values.get('password(publickey)') or values.get('password') or values.get('publickey')
    if not all(v and re.fullmatch(r'[A-Za-z0-9_-]{43}', v) for v in (private, public)):
        raise ValueError('Unrecognized Xray x25519 output')
    return dict(schema=1, public_ip=ip, sni=sni, uuid=str(uuid.uuid4()),
                private_key=private, public_key=public, short_id=secrets.token_hex(8),
                hy_password=secrets.token_hex(32), hy_obfs=secrets.token_hex(32),
                postgres_password=secrets.token_hex(32), qdrant_key=secrets.token_hex(32),
                auth_secret=secrets.token_hex(48))


def xray_client(state, server, port=443, socks_port=18081):
    return {'log': {'loglevel': 'warning'},
            'inbounds': [{'listen': '127.0.0.1', 'port': socks_port, 'protocol': 'socks',
                          'settings': {'auth': 'noauth', 'udp': True}}],
            'outbounds': [{'protocol': 'vless', 'settings': {'vnext': [{
                'address': server, 'port': port, 'users': [{'id': state['uuid'],
                'encryption': 'none', 'flow': 'xtls-rprx-vision'}]}]},
                'streamSettings': {'network': 'raw', 'security': 'reality',
                    'realitySettings': {'serverName': state['sni'], 'fingerprint': 'chrome',
                                       'password': state['public_key'], 'shortId': state['short_id']}}}]}


def hy_client(state, server, cert, port=443, socks_port=18082):
    return {'server': f'{server}:{port}', 'auth': state['hy_password'],
            'tls': {'sni': state['sni'], 'insecure': False, 'ca': str(cert)},
            'obfs': {'type': 'salamander', 'salamander': {'password': state['hy_obfs']}},
            'socks5': {'listen': f'127.0.0.1:{socks_port}'}}


def generate(base, binaries, ip, sni, release, port=443, allow_local=False):
    ip, sni = valid_ip(ip, allow_local), valid_sni(sni)
    if not re.fullmatch(r'[a-f0-9]{40}', release):
        raise ValueError('Deployment must be pinned to a full commit SHA')
    base.mkdir(mode=0o750, parents=True, exist_ok=True)
    state_path = base / 'state.json'
    if state_path.exists():
        state = json.loads(state_path.read_text())
        if state.get('schema') != 1 or (state['public_ip'], state['sni']) != (ip, sni):
            raise ValueError('Existing identity differs; refusing to replace credentials')
    else:
        state = create_state(binaries / 'xray', ip, sni)
        write(state_path, state)
    cert, key = base / 'server.crt', base / 'server.key'
    if cert.exists() != key.exists():
        raise ValueError('Certificate pair is incomplete; restore the backup')
    if not cert.exists():
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                        '-days', '825', '-keyout', str(key), '-out', str(cert),
                        '-subj', f'/CN={sni}', '-addext', f'subjectAltName=DNS:{sni}'],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(['openssl', 'x509', '-checkend', '2592000', '-noout', '-in', str(cert)],
                   check=True, stdout=subprocess.DEVNULL)
    key.chmod(0o640)
    cert.chmod(0o644)
    blocked = PRIVATE + ([] if allow_local else [ip + '/32'])
    server = {'log': {'loglevel': 'warning'}, 'inbounds': [{
        'tag': 'reality-in', 'listen': '0.0.0.0', 'port': port, 'protocol': 'vless',
        'settings': {'clients': [{'id': state['uuid'], 'flow': 'xtls-rprx-vision'}], 'decryption': 'none'},
        'streamSettings': {'network': 'raw', 'security': 'reality', 'realitySettings': {
            'show': False, 'target': f'{sni}:443', 'serverNames': [sni],
            'privateKey': state['private_key'], 'shortIds': [state['short_id']]}}}],
        'outbounds': [{'tag': 'direct', 'protocol': 'freedom',
                      # Single-VPS deployment accepts only a public IPv4 address.
                      # Constrain egress resolution to IPv4 too, so an IPv4-only
                      # host cannot randomly select an unreachable AAAA result.
                      'settings': {'domainStrategy': 'UseIPv4'}},
                      {'tag': 'block', 'protocol': 'blackhole'}],
        'routing': {'domainStrategy': 'IPOnDemand', 'rules': [
            {'type': 'field', 'ip': blocked, 'outboundTag': 'block'}]}}
    write(base / 'xray.json', server, 0o640)
    hysteria = {'listen': f'0.0.0.0:{port}', 'tls': {'cert': str(cert), 'key': str(key)},
        'auth': {'type': 'password', 'password': state['hy_password']},
        'obfs': {'type': 'salamander', 'salamander': {'password': state['hy_obfs']}},
        'acl': {'inline': [f'reject({cidr})' for cidr in blocked] + ['direct(all)']},
        'masquerade': {'type': 'string', 'string': {'content': 'OK',
            'headers': {'content-type': 'text/plain'}, 'statusCode': 200}}}
    write(base / 'hysteria.json', hysteria, 0o640)
    clients = base / 'clients'
    clients.mkdir(mode=0o700, exist_ok=True)
    write(clients / 'xray-client.json', xray_client(state, ip, port, 10808))
    write(clients / 'hysteria-client.json', hy_client(state, ip, 'server.crt', port, 10809))
    write(clients / 'server.crt', cert.read_text())
    links = []
    for fingerprint in ('chrome', 'firefox'):
        query = urlencode({'type': 'tcp', 'encryption': 'none', 'security': 'reality',
            'pbk': state['public_key'], 'fp': fingerprint, 'sni': sni,
            'sid': state['short_id'], 'flow': 'xtls-rprx-vision'})
        links.append(f'vless://{state["uuid"]}@{ip}:{port}?{query}#XFreedom-REALITY-{fingerprint}')
    # Hysteria native config includes a trusted certificate. No insecure URI:
    # several importers discard pinSHA256, which would disable authentication.
    write(clients / 'client-links.txt', '\n'.join(links) + '\n')
    write(clients / 'subscription.txt', base64.b64encode(('\n'.join(links) + '\n').encode()).decode() + '\n')
    env = {'POSTGRES_PASSWORD': state['postgres_password'],
        'DATABASE_URL': f'postgresql://xfreedom:{state["postgres_password"]}@postgres:5432/xfreedom',
        'QDRANT_API_KEY': state['qdrant_key'], 'QDRANT_URL': 'http://qdrant:6333',
        'BETTER_AUTH_SECRET': state['auth_secret'], 'XF_RELEASE': release,
        'XF_CONFIG_DIR': str(base), 'XF_APP_IMAGE': f'xfreedom-solo:{release}'}
    write(base / 'compose.env', ''.join(f'{k}={v}\n' for k, v in env.items()))
    return state


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', type=Path, required=True)
    parser.add_argument('--bin', type=Path, required=True)
    parser.add_argument('--ip', required=True)
    parser.add_argument('--sni', required=True)
    parser.add_argument('--release', required=True)
    args = parser.parse_args()
    generate(args.base, args.bin, args.ip, args.sni, args.release)
    print('Configs generated; existing credentials preserved.')