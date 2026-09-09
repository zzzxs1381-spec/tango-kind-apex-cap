#!/usr/bin/env python3
"""Exercise authenticated TCP and UDP paths, not only listening sockets."""
import argparse
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import tempfile
import time
from render import xray_client, hy_client, write


def receive(sock, size):
    data = b''
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk:
            raise OSError('SOCKS connection closed')
        data += chunk
    return data


def udp_dns(port):
    """Send a real DNS query through SOCKS5 UDP ASSOCIATE."""
    with socket.create_connection(('127.0.0.1', port), timeout=5) as tcp:
        tcp.settimeout(7)
        tcp.sendall(b'\x05\x01\x00')
        if receive(tcp, 2) != b'\x05\x00':
            raise OSError('SOCKS authentication negotiation failed')
        tcp.sendall(b'\x05\x03\x00\x01' + b'\x00' * 6)
        header = receive(tcp, 4)
        if header[1] != 0:
            raise OSError('SOCKS UDP is unavailable')
        if header[3] == 1:
            host = socket.inet_ntoa(receive(tcp, 4))
        elif header[3] == 4:
            host = socket.inet_ntop(socket.AF_INET6, receive(tcp, 16))
        else:
            host = receive(tcp, receive(tcp, 1)[0]).decode()
        relay_port = struct.unpack('!H', receive(tcp, 2))[0]
        host = '127.0.0.1' if host == '0.0.0.0' else host
        query_id = os.urandom(2)
        query = query_id + b'\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00' + b'\x07example\x03com\x00\x00\x01\x00\x01'
        packet = b'\x00\x00\x00\x01' + socket.inet_aton('1.1.1.1') + struct.pack('!H', 53) + query
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as udp:
            udp.settimeout(7)
            udp.sendto(packet, (host, relay_port))
            answer = udp.recv(4096)
        if answer[3] == 1:
            offset = 10
        elif answer[3] == 4:
            offset = 22
        else:
            offset = 7 + answer[4]
        dns = answer[offset:]
        if len(dns) < 12 or dns[:2] != query_id or not (dns[2] & 128) or dns[3] & 15:
            raise OSError('Invalid DNS response through the tunnel')


def tcp_request(port, target):
    return subprocess.run(['curl', '--silent', '--show-error', '--fail',
        '--max-time', '15', '--noproxy', '', '--socks5-hostname', f'127.0.0.1:{port}',
        target, '-o', '/dev/null'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


def test_transport(binary, kind, config, port, directory, targets=None, check_udp=True):
    targets = targets or ['https://www.gstatic.com/generate_204', 'https://example.com/']
    config_path = Path(directory) / f'{kind}-client.json'
    write(config_path, config)
    command = [str(binary), 'run', '-config', str(config_path)] if kind == 'xray' else [str(binary), 'client', '-c', str(config_path)]
    with open(Path(directory) / f'{kind}-probe.log', 'wb') as log:
        proc = subprocess.Popen(command, stdout=log, stderr=log)
        try:
            listening = False
            for _ in range(50):
                if proc.poll() is not None:
                    break
                try:
                    with socket.create_connection(('127.0.0.1', port), timeout=.2):
                        listening = True
                        break
                except OSError:
                    time.sleep(.1)
            tcp_ok = listening and any(tcp_request(port, target) for target in targets)
            udp_ok = False
            if tcp_ok and check_udp:
                try:
                    udp_dns(port)
                    udp_ok = True
                except (OSError, IndexError, struct.error):
                    pass
            return {'tcp': tcp_ok, 'udp_dns': udp_ok if check_udp else None}
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=4)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()


def probe(base, binaries, server='127.0.0.1', port=443):
    state = json.loads((base / 'state.json').read_text())
    with tempfile.TemporaryDirectory(prefix='xf-probe-') as temporary:
        tcp = test_transport(binaries / 'xray', 'xray',
            xray_client(state, server, port), 18081, temporary)
        hy = test_transport(binaries / 'hysteria', 'hysteria',
            hy_client(state, server, base / 'server.crt', port), 18082, temporary)
    result = {'checked_at': int(time.time()), 'vantage': 'server-local',
        'external_reachability_verified': False, 'russian_network_verified': False,
        'xray': tcp, 'hysteria': hy}
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', type=Path, required=True)
    parser.add_argument('--bin', type=Path, required=True)
    args = parser.parse_args()
    result = probe(args.base, args.bin)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if all(result[p][k] for p in ('xray', 'hysteria') for k in ('tcp', 'udp_dns')) else 1)
