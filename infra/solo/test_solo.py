#!/usr/bin/env python3
"""Regression checks for credential preservation, parsing, and authentication."""
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import uuid
from render import generate, valid_ip, valid_sni, xray_client, hy_client
from probe import test_transport


class Rendering(unittest.TestCase):
    def test_invalid_addresses_and_shell_inputs_rejected(self):
        for ip in ('999.2.3.4', '127.0.0.1', '10.0.0.1', '1.1.1.1; id', '::1'):
            with self.assertRaises(ValueError):
                valid_ip(ip)
        for sni in ('https://example.com', 'example.com:443', "x';id;#", 'a..com', '*.example.com'):
            with self.assertRaises(ValueError):
                valid_sni(sni)

    def test_auto_reality_targets_exclude_known_bad_microsoft_target(self):
        installer = Path(__file__).with_name('install.sh').read_text()
        candidate_lines = [
            line.strip() for line in installer.splitlines()
            if line.strip().startswith('for target in ')
        ]
        self.assertEqual(len(candidate_lines), 1)
        candidates = candidate_lines[0]
        # XTLS/Xray-core#6356 reproduces a REALITY reset on Xray 26.3.27
        # with www.microsoft.com even though direct TLS to that host succeeds.
        self.assertNotIn('www.microsoft.com', candidates)
        self.assertIn('www.cloudflare.com', candidates)
        self.assertIn('www.apple.com', candidates)
        self.assertIn('www.bing.com', candidates)

    def test_rerun_preserves_all_credentials_and_certificates(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            pair = 'PrivateKey: ' + 'A' * 43 + '\nPassword (PublicKey): ' + 'B' * 43 + '\nHash32: unused\n'
            with patch('subprocess.check_output', return_value=pair) as keygen:
                generate(base, base, '8.8.8.8', 'example.com', 'a' * 40)
                before = {p.name: p.read_bytes() for p in base.iterdir() if p.is_file()}
                generate(base, base, '8.8.8.8', 'example.com', 'a' * 40)
                self.assertEqual(keygen.call_count, 1)
                for name, data in before.items():
                    self.assertEqual(data, (base / name).read_bytes())
                with self.assertRaises(ValueError):
                    generate(base, base, '9.9.9.9', 'example.com', 'a' * 40)
            self.assertEqual((base / 'state.json').stat().st_mode & 0o777, 0o600)
            self.assertEqual((base / 'clients').stat().st_mode & 0o777, 0o700)
            config = json.loads((base / 'xray.json').read_text())
            self.assertTrue(config['inbounds'][0]['settings']['clients'])
            # The solo installer accepts a public IPv4 address only. Both the
            # Xray internal resolver (used by IPOnDemand) and Freedom egress
            # therefore stay on A records / IPv4.
            self.assertEqual(config['dns']['queryStrategy'], 'UseIPv4')
            self.assertEqual(config['outbounds'][0]['settings']['domainStrategy'], 'UseIPv4')
            client = json.loads((base / 'clients/hysteria-client.json').read_text())
            self.assertFalse(client['tls']['insecure'])
            self.assertEqual(client['tls']['ca'], 'server.crt')


@unittest.skipUnless(os.getenv('XF_LIVE_TEST') == '1', 'Requires the installed ephemeral CI stack')
class LiveAuthentication(unittest.TestCase):
    def setUp(self):
        self.base = Path('/etc/xfreedom-solo')
        self.bin = Path('/opt/xfreedom-solo/current/bin')
        self.state = json.loads((self.base / 'state.json').read_text())

    def test_wrong_xray_identity_is_rejected(self):
        state = copy.deepcopy(self.state)
        state['uuid'] = str(uuid.uuid4())
        with tempfile.TemporaryDirectory() as td:
            result = test_transport(self.bin / 'xray', 'xray',
                xray_client(state, '127.0.0.1'), 18081, td, check_udp=False)
        self.assertFalse(result['tcp'])

    def test_wrong_hysteria_certificate_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            fake = Path(td) / 'other.crt'
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
                '-keyout', str(Path(td) / 'other.key'), '-out', str(fake), '-subj', '/CN=other.example'],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            result = test_transport(self.bin / 'hysteria', 'hysteria',
                hy_client(self.state, '127.0.0.1', fake), 18082, td, check_udp=False)
        self.assertFalse(result['tcp'])

    def test_vpn_cannot_reach_private_admin(self):
        with tempfile.TemporaryDirectory() as td:
            for kind, config, port in (
                ('xray', xray_client(self.state, '127.0.0.1'), 18081),
                ('hysteria', hy_client(self.state, '127.0.0.1', self.base / 'server.crt'), 18082)):
                result = test_transport(self.bin / kind, kind, config, port, td,
                    targets=['http://127.0.0.1:8080/api/health'], check_udp=False)
                self.assertFalse(result['tcp'], kind)


if __name__ == '__main__':
    unittest.main()